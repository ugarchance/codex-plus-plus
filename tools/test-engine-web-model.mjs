#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const logFile = process.argv[2];
const model = process.argv[3] ?? "chatgpt-web/pro";
const withCatalog = process.argv.includes("--with-catalog");
const withCodeMode = process.argv.includes("--code-mode");

if (!logFile) {
  console.error("usage: test-engine-web-model.mjs <codexpp log> [model] [--with-catalog]");
  process.exit(1);
}

const log = fs.readFileSync(logFile, "utf8");
const route = [...log.matchAll(/codexpp gateway on (http:\/\/127\.0\.0\.1:\d+\/backend-api\/codex)/g)].at(-1)?.[1];
if (!route) throw new Error("gateway route not found in the log");
console.log(`gateway ${route}`);
console.log(`model   ${model}`);
console.log(`catalog ${withCatalog ? "thread config'inde veriliyor" : "verilmiyor"}\n`);

const CODEX_BIN = "/Applications/ChatGPT.app/Contents/Resources/codex";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "engine-web-model-"));
fs.copyFileSync(path.join(os.homedir(), ".codex", "auth.json"), path.join(home, "auth.json"));
fs.chmodSync(path.join(home, "auth.json"), 0o600);
fs.writeFileSync(path.join(home, "config.toml"), [
  `model = "gpt-5.6-sol"`,
  `approval_policy = "never"`,
  `sandbox_mode = "read-only"`,
  `stream_max_retries = 1`,
  `request_max_retries = 1`,
  ``,
].join("\n"));

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

try {
  await send("initialize", {
    clientInfo: { name: "engine-web-model-test", version: "1.0.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);

  const config = { openai_base_url: route };
  if (withCatalog) {
    const models = await send("model/list", { includeHidden: true, cursor: null, limit: 100 });
    const template = (models?.data ?? []).find((r) => !r.hidden) ?? models?.data?.[0];
    const catalogPath = path.join(home, "catalog.json");
    fs.writeFileSync(catalogPath, JSON.stringify({
      models: [{
        slug: model,
        display_name: "ChatGPT Web — Pro",
        description: "ChatGPT Pro through the web session.",
        visibility: "list",
        supported_in_api: true,
        input_modalities: ["text", "image"],
        context_window: 200000,
        max_context_window: 200000,
        supported_reasoning_levels: [{ effort: "ultra", description: "Pro" }],
        tool_mode: template?.toolMode ?? "code_mode_only",
        prefer_websockets: false,
      }],
    }));
    config.model_catalog_json = catalogPath;
    config.features = { code_mode: true, code_mode_only: true };
  }

  if (withCodeMode) config.features = { code_mode: true, code_mode_only: true };

  const thread = await send("thread/start", { cwd: home, model, config, allowProviderModelFallback: false });
  const threadId = thread?.threadId ?? thread?.thread?.id ?? thread?.id;
  console.log(`thread ${threadId}`);

  const started = Date.now();
  await send("turn/start", {
    threadId,
    model,
    input: [{ type: "text", text: "Reply with exactly: codexpp-engine-ok" }],
  }).catch((err) => console.log(`turn/start hata: ${err.message}`));

  const deadline = Date.now() + 540_000;
  while (Date.now() < deadline) {
    if (notifications.some((n) => n.method === "turn/completed" || n.method === "turn/failed")) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const answers = notifications
    .filter((n) => n.method === "item/completed" && n.params?.item?.type === "agentMessage")
    .map((n) => n.params.item.text);
  const errors = notifications.filter((n) => n.method === "error").map((n) => n.params?.error?.message);

  console.log(`\nsüre     ${seconds}s`);
  console.log(`yanıt    ${answers.length ? JSON.stringify(answers.at(-1)?.slice(0, 160)) : "(yok)"}`);
  if (errors.length) console.log(`hatalar  ${JSON.stringify([...new Set(errors)].slice(0, 3))}`);
  if (!answers.length && stderr.trim()) console.log(`\nstderr:\n${stderr.slice(0, 900)}`);
  process.exitCode = answers.length ? 0 : 1;
} finally {
  child.kill();
  fs.rmSync(home, { recursive: true, force: true });
}
