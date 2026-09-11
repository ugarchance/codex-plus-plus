#!/usr/bin/env node

// End to end: Codex picker row -> gateway -> ChatGPT normal chat with the Codex Native2 plugin ->
// codex_exec over the tunnel -> Codex runs it locally -> answer. Needs a running Codex++ and a
// connected tunnel.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveInstalledCodexBinary } from "./installed-paths.mjs";

const source = process.argv[2];
if (!source) {
  console.error("usage: test-harness-e2e.mjs <codexpp log | gateway url>");
  process.exit(1);
}
const route = source.startsWith("http")
  ? source
  : [...fs.readFileSync(source, "utf8")
      .matchAll(/codexpp gateway on (http:\/\/127\.0\.0\.1:\d+\/backend-api\/codex)/g)].at(-1)?.[1];
if (!route) throw new Error("gateway route not found in the log");

const FIXTURE = `codexpp-${Date.now().toString(36)}`;
const CODEX_BIN = resolveInstalledCodexBinary();
const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-e2e-"));
fs.copyFileSync(path.join(os.homedir(), ".codex", "auth.json"), path.join(home, "auth.json"));
fs.chmodSync(path.join(home, "auth.json"), 0o600);
fs.writeFileSync(path.join(home, "config.toml"),
  `model = "gpt-5.6-sol"\napproval_policy = "never"\nsandbox_mode = "read-only"\nstream_max_retries = 1\nrequest_max_retries = 1\n`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "harness-work-"));
fs.writeFileSync(path.join(work, "tool-fixture.txt"), `${FIXTURE}\n`);
console.log(`gateway ${route}\ncwd     ${work}\nfixture tool-fixture.txt\n`);

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

const send = (method, params, timeoutMs = 900_000) => {
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
  await send("initialize", { clientInfo: { name: "harness-e2e", version: "1.0.0" }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);

  const thread = await send("thread/start", {
    cwd: work,
    model: "chatgpt-web/sol-full",
    config: { openai_base_url: route, features: { code_mode: true, code_mode_only: true } },
  });
  const threadId = thread?.threadId ?? thread?.thread?.id ?? thread?.id;

  const started = Date.now();
  send("turn/start", {
    threadId,
    model: "chatgpt-web/sol-full",
    input: [{ type: "text", text: "Bu klasördeki tool-fixture.txt dosyasını native araçla oku ve içeriğini yanıtında belirt." }],
  }).catch((err) => console.log(`turn/start hata: ${err.message}`));

  const deadline = Date.now() + 840_000;
  while (Date.now() < deadline) {
    if (notifications.some((n) => n.method === "turn/completed" || n.method === "turn/failed")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const answer = notifications
    .filter((n) => n.method === "item/completed" && n.params?.item?.type === "agentMessage")
    .map((n) => n.params.item.text)
    .at(-1) ?? "";
  const errors = notifications.filter((n) => n.method === "error").map((n) => n.params?.error?.message);

  console.log(`\nsüre  ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (errors.length) console.log(`hatalar ${JSON.stringify([...new Set(errors)].slice(0, 3))}`);
  check("ChatGPT dosyayı yerelden okudu", answer.includes(FIXTURE), JSON.stringify(answer.slice(0, 200)));
} finally {
  child.kill();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} kontrol başarısız` : `\ntüm kontroller geçti`);
process.exit(failures ? 1 : 0);
