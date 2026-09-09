#!/usr/bin/env node

// Proves gateway <-> turn-broker <-> Codex code mode without a browser: a stub web session plays
// the part of ChatGPT and asks for one `exec` tool call through the broker.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const hubRequire = createRequire(new URL("../hub/", import.meta.url));
const broker = hubRequire("./turn-broker.cjs");

const sessionPath = hubRequire.resolve("./web-session.cjs");
hubRequire.cache[sessionPath] = {
  id: sessionPath,
  filename: sessionPath,
  loaded: true,
  exports: {
    async runTurn({ token }) {
      if (!token) throw new Error("stub oturumuna harness token'ı ulaşmadı");
      const source = 'const r = await tools.exec_command({"cmd":"echo codexpp-loop-ok","workdir":"/tmp","yield_time_ms":10000,"max_output_tokens":1000});\ntext(r.output);\n';
      const output = await broker.requestTool(token, source);
      return { text: `ChatGPT gördü: ${output}`, effort: { applied: false }, reused: false, chars: 0 };
    }
  }
};

const gateway = hubRequire("./gateway.cjs");
const { baseUrl } = await gateway.start();
console.log(`gateway ${baseUrl}\n`);

const CODEX_BIN = "/Applications/ChatGPT.app/Contents/Resources/codex";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-loop-"));
fs.copyFileSync(path.join(os.homedir(), ".codex", "auth.json"), path.join(home, "auth.json"));
fs.chmodSync(path.join(home, "auth.json"), 0o600);
fs.writeFileSync(path.join(home, "config.toml"),
  `model = "gpt-5.6-sol"\napproval_policy = "never"\nsandbox_mode = "read-only"\nstream_max_retries = 1\nrequest_max_retries = 1\n`);

const child = spawn(CODEX_BIN, ["app-server"], {
  env: { ...process.env, CODEX_HOME: home, RUST_LOG: "error" },
  stdio: ["pipe", "pipe", "ignore"],
});

const pending = new Map();
const notifications = [];
let nextId = 1;
let buffer = "";
child.stdout.on("data", (chunk) => {
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
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
};

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${label}${detail !== undefined ? `  ${detail}` : ""}`);
  if (!ok) failures += 1;
};

try {
  await send("initialize", { clientInfo: { name: "harness-loop", version: "1.0.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);

  const thread = await send("thread/start", {
    cwd: home,
    model: "chatgpt-web/pro-harness",
    config: { openai_base_url: baseUrl, features: { code_mode: true, code_mode_only: true } },
  });
  const threadId = thread?.threadId ?? thread?.thread?.id ?? thread?.id;

  await send("turn/start", { threadId, model: "chatgpt-web/pro-harness", input: [{ type: "text", text: "harness loop" }] })
    .catch((err) => console.log(`turn/start hata: ${err.message}`));

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (notifications.some((n) => n.method === "turn/completed" || n.method === "turn/failed")) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  const answer = notifications
    .filter((n) => n.method === "item/completed" && n.params?.item?.type === "agentMessage")
    .map((n) => n.params.item.text)
    .at(-1) ?? "";

  check("Codex enjekte edilen exec'i çalıştırdı", answer.includes("codexpp-loop-ok"), JSON.stringify(answer.slice(0, 160)));
  check("çıktı ChatGPT tarafına döndü", answer.startsWith("ChatGPT gördü:"), undefined);
} finally {
  child.kill();
  await gateway.stop();
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} kontrol başarısız` : `\ntüm kontroller geçti`);
process.exit(failures ? 1 : 0);
