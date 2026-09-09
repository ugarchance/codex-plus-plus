#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const logFile = process.argv[2];
const model = process.argv[3] ?? "chatgpt-web/pro";
if (!logFile) {
  console.error("usage: test-web-continuity.mjs <codexpp log> [model]");
  process.exit(1);
}

const route = [...fs.readFileSync(logFile, "utf8")
  .matchAll(/codexpp gateway on (http:\/\/127\.0\.0\.1:\d+\/backend-api\/codex)/g)].at(-1)?.[1];
if (!route) throw new Error("gateway route not found in the log");
console.log(`gateway ${route}\nmodel   ${model}\n`);

const CODEX_BIN = "/Applications/ChatGPT.app/Contents/Resources/codex";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "web-continuity-"));
fs.copyFileSync(path.join(os.homedir(), ".codex", "auth.json"), path.join(home, "auth.json"));
fs.chmodSync(path.join(home, "auth.json"), 0o600);
fs.writeFileSync(path.join(home, "config.toml"),
  `model = "gpt-5.6-sol"\napproval_policy = "never"\nsandbox_mode = "read-only"\nstream_max_retries = 1\nrequest_max_retries = 1\n`);

const child = spawn(CODEX_BIN, ["app-server"], {
  env: { ...process.env, CODEX_HOME: home, RUST_LOG: "error" },
  stdio: ["pipe", "pipe", "ignore"],
});

const pending = new Map();
let notifications = [];
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

const send = (method, params, timeoutMs = 600_000) => {
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

async function turn(threadId, text) {
  notifications = [];
  const started = Date.now();
  await send("turn/start", { threadId, model, input: [{ type: "text", text }] })
    .catch((err) => console.log(`  turn/start hata: ${err.message}`));
  const deadline = Date.now() + 540_000;
  while (Date.now() < deadline) {
    if (notifications.some((n) => n.method === "turn/completed" || n.method === "turn/failed")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const answers = notifications
    .filter((n) => n.method === "item/completed" && n.params?.item?.type === "agentMessage")
    .map((n) => n.params.item.text);
  console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s  ${JSON.stringify(answers.at(-1)?.slice(0, 120) ?? null)}`);
}

try {
  await send("initialize", { clientInfo: { name: "web-continuity", version: "1.0.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);

  const thread = await send("thread/start", { cwd: home, model, config: { openai_base_url: route } });
  const threadId = thread?.threadId ?? thread?.thread?.id ?? thread?.id;
  console.log(`thread ${threadId}`);

  console.log(`\n1. tur: "Benim gizli kelimem: papatya. Sadece 'tamam' yaz."`);
  await turn(threadId, "Benim gizli kelimem: papatya. Sadece 'tamam' yaz.");

  console.log(`\n2. tur: "Gizli kelimem neydi? Tek kelimeyle yaz."`);
  await turn(threadId, "Gizli kelimem neydi? Tek kelimeyle yaz.");
} finally {
  child.kill();
  fs.rmSync(home, { recursive: true, force: true });
}
