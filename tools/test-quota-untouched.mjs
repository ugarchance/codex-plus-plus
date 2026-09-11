#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveInstalledCodexBinary } from "./installed-paths.mjs";

const logFile = process.argv[2];
const model = process.argv[3] ?? "chatgpt-web/sol-full";
if (!logFile) {
  console.error("usage: test-quota-untouched.mjs <codexpp log> [model]");
  process.exit(1);
}

const route = [...fs.readFileSync(logFile, "utf8")
  .matchAll(/codexpp gateway on (http:\/\/127\.0\.0\.1:\d+\/backend-api\/codex)/g)].at(-1)?.[1];
if (!route) throw new Error("gateway route not found in the log");

const CODEX_BIN = resolveInstalledCodexBinary();
const home = fs.mkdtempSync(path.join(os.tmpdir(), "quota-check-"));
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

function summarise(limits) {
  const windows = limits?.rateLimits ?? limits ?? {};
  const rows = [];
  for (const [name, value] of Object.entries(windows)) {
    if (value && typeof value === "object" && typeof value.usedPercent === "number") {
      rows.push(`${name}=${value.usedPercent}%`);
    }
  }
  return rows.length ? rows.join(" ") : JSON.stringify(windows).slice(0, 200);
}

try {
  await send("initialize", { clientInfo: { name: "quota-check", version: "1.0.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);

  const before = await send("account/rateLimits/read", {});
  console.log(`önce   ${summarise(before)}`);

  const thread = await send("thread/start", { cwd: home, model, config: { openai_base_url: route } });
  const threadId = thread?.threadId ?? thread?.thread?.id ?? thread?.id;
  await send("turn/start", {
    threadId, model,
    input: [{ type: "text", text: "Reply with exactly: quota-check-ok" }],
  }).catch((err) => console.log(`turn hata: ${err.message}`));

  const deadline = Date.now() + 540_000;
  while (Date.now() < deadline) {
    if (notifications.some((n) => n.method === "turn/completed" || n.method === "turn/failed")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const answers = notifications
    .filter((n) => n.method === "item/completed" && n.params?.item?.type === "agentMessage")
    .map((n) => n.params.item.text);
  console.log(`yanıt  ${answers.length ? JSON.stringify(answers.at(-1)?.slice(0, 80)) : "(yok)"}`);

  await new Promise((r) => setTimeout(r, 3000));
  const after = await send("account/rateLimits/read", {});
  console.log(`sonra  ${summarise(after)}`);

  const same = JSON.stringify(before?.rateLimits ?? before) === JSON.stringify(after?.rateLimits ?? after);
  console.log(`\n${same ? "[PASS] Codex kotası değişmedi" : "[DİKKAT] Codex kotası değişti"}`);
  process.exitCode = same ? 0 : 1;
} finally {
  child.kill();
  fs.rmSync(home, { recursive: true, force: true });
}
