#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

const CODEX_BIN = "/Applications/ChatGPT.app/Contents/Resources/codex";
const REAL_HOME = path.join(os.homedir(), ".codex");
const UPSTREAM = "https://chatgpt.com/backend-api/codex";

const hits = [];
let catalogSample = null;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    const auth = req.headers.authorization ?? "";
    const hit = {
      method: req.method,
      url: req.url,
      authScheme: auth.split(" ")[0] ?? null,
      authLength: auth.length,
      originator: req.headers["originator"] ?? null,
      accountId: req.headers["chatgpt-account-id"] ? "<present>" : null,
      headerNames: Object.keys(req.headers).sort(),
      bodyBytes: body.length,
    };

    const isModels = req.url.startsWith("/backend-api/codex/models");
    if (isModels) {
      try {
        const upstream = await fetch(`${UPSTREAM}/models${req.url.split("?")[1] ? `?${req.url.split("?")[1]}` : ""}`, {
          method: req.method,
          headers: {
            authorization: auth,
            "chatgpt-account-id": req.headers["chatgpt-account-id"] ?? "",
            originator: req.headers["originator"] ?? "codex_cli_rs",
            "user-agent": req.headers["user-agent"] ?? "",
            version: req.headers["version"] ?? "",
            accept: req.headers["accept"] ?? "application/json",
          },
        });
        const text = await upstream.text();
        hit.proxied = upstream.status;
        if (upstream.ok && !catalogSample) catalogSample = text;
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
        res.end(text);
      } catch (err) {
        hit.proxyError = err.message;
        res.writeHead(502, { "content-type": "application/json" });
        res.end(`{"error":{"message":"proxy failed"}}`);
      }
      hits.push(hit);
      return;
    }

    hit.bodyHead = body.toString("utf8").slice(0, 2500);
    hits.push(hit);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(`{"error":{"message":"route-probe sink: captured"}}`);
  });
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/backend-api/codex`;

const home = fs.mkdtempSync(path.join(os.tmpdir(), "route-probe-"));
fs.copyFileSync(path.join(REAL_HOME, "auth.json"), path.join(home, "auth.json"));
fs.chmodSync(path.join(home, "auth.json"), 0o600);
fs.writeFileSync(
  path.join(home, "config.toml"),
  [
    `openai_base_url = "${baseUrl}"`,
    `model = "gpt-5.6-sol"`,
    `approval_policy = "never"`,
    `sandbox_mode = "read-only"`,
    `stream_max_retries = 0`,
    `request_max_retries = 0`,
    ``,
  ].join("\n"),
);

console.log(`sink       ${baseUrl}`);
console.log(`CODEX_HOME ${home}\n`);

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

const send = (method, params, timeoutMs = 30000) => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
};

const step = async (label, fn) => {
  const before = hits.length;
  try {
    const result = await fn();
    console.log(`[ok]   ${label}  (+${hits.length - before} sink hits)`);
    return result;
  } catch (err) {
    console.log(`[fail] ${label}: ${err.message}  (+${hits.length - before} sink hits)`);
    return undefined;
  }
};

try {
  await send("initialize", {
    clientInfo: { name: "route-probe", version: "1.0.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
  console.log("[ok]   initialize");

  const models = await step("model/list", () => send("model/list", {}));
  const rows = models?.models ?? models?.items ?? [];
  console.log(`       models=${rows.length}  ${rows.slice(0, 8).map((m) => m.slug ?? m.id).join(", ")}`);

  const thread = await step("thread/start", () => send("thread/start", { cwd: home }));
  const threadId = thread?.threadId ?? thread?.thread?.id ?? thread?.id;
  console.log(`       threadId=${threadId ?? "?"}`);

  if (threadId) {
    await step("turn/start", () => send("turn/start", {
      threadId,
      input: [{ type: "text", text: "say ok" }],
    }, 30000));
  }

  await new Promise((r) => setTimeout(r, 4000));
} finally {
  child.kill();
  server.close();
}

console.log(`\n=== sink hits: ${hits.length} ===`);
for (const hit of hits) console.log(JSON.stringify(hit));

if (catalogSample) {
  fs.writeFileSync(path.join(os.tmpdir(), "models-response.json"), catalogSample);
  console.log(`\ncatalog sample written (${catalogSample.length} bytes)`);
}
const responsesHit = hits.find((h) => h.method === "POST" && h.bodyHead);
if (responsesHit) {
  fs.writeFileSync(path.join(os.tmpdir(), "responses-request-head.json"), responsesHit.bodyHead);
  console.log(`responses POST body head written`);
}
if (stderr.trim()) console.log(`\n=== app-server stderr ===\n${stderr.slice(0, 1500)}`);
console.log(`\n=== last notifications ===`);
for (const n of notifications.slice(-10)) console.log(`${n.method}  ${JSON.stringify(n.params).slice(0, 220)}`);
fs.rmSync(home, { recursive: true, force: true });
