#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const gateway = require("../hub/gateway.cjs");

const CODEX_BIN = process.env.CODEX_BIN ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
const REAL_HOME = path.join(os.homedir(), ".codex");

const { baseUrl } = await gateway.start();
console.log(`gateway    ${baseUrl}`);

const home = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-gateway-test-"));
fs.copyFileSync(path.join(REAL_HOME, "auth.json"), path.join(home, "auth.json"));
fs.chmodSync(path.join(home, "auth.json"), 0o600);
fs.writeFileSync(path.join(home, "config.toml"), [
  `model = "gpt-5.6-sol"`,
  `model_reasoning_effort = "low"`,
  `approval_policy = "never"`,
  `sandbox_mode = "read-only"`,
  `stream_max_retries = 1`,
  `request_max_retries = 1`,
  ``,
].join("\n"));
console.log(`CODEX_HOME ${home}  (no openai_base_url in config.toml)\n`);

const child = spawn(CODEX_BIN, ["app-server"], {
  env: { ...process.env, CODEX_HOME: home, RUST_LOG: "error" },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (c) => { stderr += c; });

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
    } else if (msg.method) {
      notifications.push(msg);
    }
  }
});

const send = (method, params, timeoutMs = 45000) => {
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
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures += 1;
};

try {
  await send("initialize", {
    clientInfo: { name: "codexpp-gateway-test", version: "1.0.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);

  const thread = await send("thread/start", { cwd: home, config: { openai_base_url: baseUrl } });
  const threadId = thread?.threadId ?? thread?.thread?.id ?? thread?.id;
  check("thread/start accepted the per-thread route", Boolean(threadId), `threadId=${threadId}`);

  await send("turn/start", {
    threadId,
    input: [{ type: "text", text: "Reply with the single word: ok" }],
  }).catch((err) => { console.log(`       turn/start: ${err.message}`); });

  const deadline = Date.now() + 40000;
  while (Date.now() < deadline && !notifications.some((n) => n.method === "turn/completed" || n.method === "turn/failed")) {
    await new Promise((r) => setTimeout(r, 500));
  }

  const errors = notifications.filter((n) => n.method === "error");
  const agentText = notifications
    .filter((n) => n.method === "item/completed" && n.params?.item?.type === "agentMessage")
    .map((n) => JSON.stringify(n.params.item.content ?? n.params.item).slice(0, 160));

  check("no stream errors surfaced", errors.length === 0, errors.length ? errors[0].params?.error?.message : "");
  check("the model answered through the gateway", agentText.length > 0, agentText[0] ?? "");
  check("engine fell back off websockets", (stderr.match(/responses_websocket/g) ?? []).length <= 1);
} finally {
  child.kill();
  await gateway.stop();
  fs.rmSync(home, { recursive: true, force: true });
}

if (stderr.trim() && failures) console.log(`\n=== app-server stderr ===\n${stderr.slice(0, 1200)}`);
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed`);
process.exit(failures ? 1 : 0);
