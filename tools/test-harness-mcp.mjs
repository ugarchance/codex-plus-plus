#!/usr/bin/env node

// Drives the whole harness except the browser: an MCP client speaks to hub/mcp-server.cjs exactly
// the way ChatGPT does, and the script it asks for is executed by a real Codex engine.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const hubRequire = createRequire(new URL("../hub/", import.meta.url));

let capturedToken = null;
let finishBrowser = null;
const browserDone = new Promise((resolve) => { finishBrowser = resolve; });

const sessionPath = hubRequire.resolve("./web-session.cjs");
hubRequire.cache[sessionPath] = {
  id: sessionPath,
  filename: sessionPath,
  loaded: true,
  exports: {
    async runTurn({ token }) {
      capturedToken = token;
      return browserDone;
    }
  }
};

const gateway = hubRequire("./gateway.cjs");
const brokerSocket = hubRequire("./broker-socket.cjs");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "harness-mcp-"));
const { baseUrl } = await gateway.start();
const { socketPath } = await brokerSocket.start(path.join(work, "broker.sock"));
console.log(`gateway ${baseUrl}\nsocket  ${socketPath}\n`);

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${label}${detail !== undefined ? `  ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const CODEX_BIN = "/Applications/ChatGPT.app/Contents/Resources/codex";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-mcp-home-"));
fs.copyFileSync(path.join(os.homedir(), ".codex", "auth.json"), path.join(home, "auth.json"));
fs.chmodSync(path.join(home, "auth.json"), 0o600);
fs.writeFileSync(path.join(home, "config.toml"),
  `model = "gpt-5.6-sol"\napproval_policy = "never"\nsandbox_mode = "read-only"\nstream_max_retries = 1\nrequest_max_retries = 1\n`);

const engine = spawn(CODEX_BIN, ["app-server"], {
  env: { ...process.env, CODEX_HOME: home, RUST_LOG: "error" },
  stdio: ["pipe", "pipe", "ignore"],
});

const pending = new Map();
const notifications = [];
let nextId = 1;
let buffer = "";
engine.stdout.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const settle = pending.get(msg.id);
      pending.delete(msg.id);
      settle(msg);
    } else if (msg.method) notifications.push(msg);
  }
});

const send = (method, params, timeoutMs = 300_000) => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    });
    engine.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
};

// An MCP client that talks to hub/mcp-server.cjs over stdio, like the tunnel does.
function mcpClient() {
  const child = spawn(process.execPath, [hubRequire.resolve("./mcp-server.cjs"), "--broker-socket", socketPath], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const waiting = new Map();
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    out += chunk;
    let nl;
    while ((nl = out.indexOf("\n")) !== -1) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const settle = waiting.get(msg.id);
      if (!settle) continue;
      waiting.delete(msg.id);
      settle(msg);
    }
  });
  let id = 0;
  const call = (method, params) => new Promise((resolve) => {
    const current = ++id;
    waiting.set(current, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: current, method, params })}\n`);
  });
  return { call, stop: () => child.kill() };
}

const mcp = mcpClient();

try {
  await send("initialize", { clientInfo: { name: "harness-mcp", version: "1.0.0" }, capabilities: { experimentalApi: true } });
  engine.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);

  const thread = await send("thread/start", {
    cwd: home,
    model: "chatgpt-web/pro-harness",
    config: { openai_base_url: baseUrl, features: { code_mode: true, code_mode_only: true } },
  });
  const threadId = thread?.threadId ?? thread?.thread?.id ?? thread?.id;

  send("turn/start", { threadId, model: "chatgpt-web/pro-harness", input: [{ type: "text", text: "harness mcp" }] })
    .catch(() => {});

  const deadline = Date.now() + 60_000;
  while (!capturedToken && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  check("gateway turn token üretti", typeof capturedToken === "string" && capturedToken.startsWith("cxp_"));

  const discover = await mcp.call("server/discover", {});
  check("server/discover hata döndürüyor", discover.error?.code === -32601, JSON.stringify(discover.error ?? discover.result));

  const listed = await mcp.call("tools/list", {});
  check("codex_exec aracı listeleniyor", listed.result?.tools?.[0]?.name === "codex_exec");

  const call = { cmd: "echo codexpp-mcp-ok", workdir: "/tmp", yield_time_ms: 10_000 };
  const called = await mcp.call("tools/call", { name: "codex_exec", arguments: { turn_token: capturedToken, ...call } });
  const text = called.result?.content?.[0]?.text ?? "";
  check("Codex komutu çalıştırdı, çıktı MCP'ye döndü", text.includes("codexpp-mcp-ok"), JSON.stringify(text.slice(0, 120)));

  const rejected = await mcp.call("tools/call", { name: "codex_exec", arguments: { turn_token: "cxp_bogus", ...call } });
  check("geçersiz token reddediliyor", rejected.result?.isError === true, JSON.stringify(rejected.result?.content?.[0]?.text ?? ""));

  finishBrowser({ text: `ChatGPT gördü: ${text}`, effort: { applied: false }, reused: false, chars: 0 });

  const turnDeadline = Date.now() + 60_000;
  while (Date.now() < turnDeadline) {
    if (notifications.some((n) => n.method === "turn/completed" || n.method === "turn/failed")) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const answer = notifications
    .filter((n) => n.method === "item/completed" && n.params?.item?.type === "agentMessage")
    .map((n) => n.params.item.text)
    .at(-1) ?? "";
  check("nihai cevap Codex'e ulaştı", answer.includes("codexpp-mcp-ok"), JSON.stringify(answer.slice(0, 120)));
} finally {
  mcp.stop();
  engine.kill();
  await brokerSocket.stop();
  await gateway.stop();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} kontrol başarısız` : `\ntüm kontroller geçti`);
process.exit(failures ? 1 : 0);
