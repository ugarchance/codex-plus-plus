#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { spawn } from "node:child_process";

const CODEX_BIN = process.env.CODEX_BIN
  ?? (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "CodexPP", "resources", "codex.exe")
    : "/Applications/ChatGPT.app/Contents/Resources/codex");
const REAL_HOME = path.join(os.homedir(), ".codex");
const UPSTREAM = "https://chatgpt.com/backend-api/codex";
const variant = process.argv[2] ?? "426";

async function fetchCatalog(query, headers) {
  const upstream = await fetch(`${UPSTREAM}/models${query ? `?${query}` : ""}`, {
    headers: {
      authorization: headers.authorization ?? "",
      "chatgpt-account-id": headers["chatgpt-account-id"] ?? "",
      originator: headers.originator ?? "codex_cli_rs",
      "user-agent": headers["user-agent"] ?? "",
      version: headers.version ?? "",
      accept: "application/json",
    },
  });
  if (!upstream.ok) throw new Error(`upstream /models returned ${upstream.status}`);
  return upstream.json();
}

function catalogFor(variant, catalog) {
  if (variant === "no-ws") return { models: catalog.models.map((m) => ({ ...m, prefer_websockets: false })) };
  if (variant === "inject") {
    const template = catalog.models.find((m) => m.slug === "gpt-5.6-luna") ?? catalog.models[0];
    const injected = {
      ...structuredClone(template),
      slug: "chatgpt-web/probe",
      display_name: "Probe Web Row",
      description: "injected by transport-probe",
      prefer_websockets: false,
    };
    return { models: [...catalog.models, injected] };
  }
  return catalog;
}

async function run(variant) {
  const hits = [];
  let postBody = null;

  let upstreamCatalog = null;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      const upgrade = (req.headers.upgrade ?? "").toLowerCase();
      const hit = { method: req.method, url: req.url.split("?")[0], upgrade: upgrade || null, bodyBytes: body.length, contentEncoding: req.headers["content-encoding"] ?? null, contentType: req.headers["content-type"] ?? null, accept: req.headers["accept"] ?? null, acceptEncoding: req.headers["accept-encoding"] ?? null };

      if (req.url.startsWith("/backend-api/codex/models")) {
        hit.action = "catalog";
        hits.push(hit);
        try {
          upstreamCatalog ??= await fetchCatalog(req.url.split("?")[1] ?? "", req.headers);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(catalogFor(variant, upstreamCatalog)));
        } catch (err) {
          hit.catalogError = err.message;
          res.writeHead(502, { "content-type": "application/json" });
          res.end(`{"error":{"message":"catalog proxy failed"}}`);
        }
        return;
      }

      if (upgrade === "websocket") {
        hit.action = "426";
        hits.push(hit);
        res.writeHead(426, { "content-type": "application/json", connection: "close" });
        res.end(`{"error":{"message":"websocket not supported; use http"}}`);
        return;
      }

      if (req.method === "POST") {
        hit.action = "captured-post";
        if (!postBody) postBody = body;
        hits.push(hit);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(`{"error":{"message":"sink captured the post"}}`);
        return;
      }

      hit.action = "other-500";
      hits.push(hit);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(`{"error":{"message":"sink"}}`);
    });
  });
  server.on("upgrade", (req, socket) => {
    hits.push({ method: req.method, url: req.url.split("?")[0], upgrade: "websocket", action: "426-on-upgrade-event" });
    socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/backend-api/codex`;

  const home = fs.mkdtempSync(path.join(os.tmpdir(), `transport-${variant}-`));
  fs.copyFileSync(path.join(REAL_HOME, "auth.json"), path.join(home, "auth.json"));
  fs.chmodSync(path.join(home, "auth.json"), 0o600);
  fs.writeFileSync(path.join(home, "config.toml"), [
    `openai_base_url = "${baseUrl}"`,
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
      }
    }
  });
  const send = (method, params, timeoutMs = 30000) => {
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
    await send("initialize", { clientInfo: { name: "transport-probe", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
    const models = await send("model/list", {}).catch((e) => ({ error: e.message }));
    const rows = models?.models ?? models?.items ?? [];
    const thread = await send("thread/start", { cwd: home });
    const threadId = thread?.threadId ?? thread?.thread?.id ?? thread?.id;
    await send("turn/start", { threadId, input: [{ type: "text", text: "say ok" }] }, 30000).catch(() => {});
    await new Promise((r) => setTimeout(r, 6000));

    console.log(`\n########## variant: ${variant} ##########`);
    const listRows = models?.data ?? rows;
    console.log(`model/list rows=${Array.isArray(listRows) ? listRows.length : "?"} keys=${Object.keys(models ?? {}).join(",")} slugs=${Array.isArray(listRows) ? listRows.slice(0,6).map((m)=>m.slug ?? m.id).join(",") : ""}`);
    const catalogTemplate = upstreamCatalog?.models?.[0];
    if (catalogTemplate) console.log(`catalog model keys=${Object.keys(catalogTemplate).sort().join(",")}`);
    const tally = {};
    for (const h of hits) tally[`${h.method} ${h.url} ${h.action}`] = (tally[`${h.method} ${h.url} ${h.action}`] ?? 0) + 1;
    for (const [k, v] of Object.entries(tally)) console.log(`  ${String(v).padStart(3)}x  ${k}`);
    if (postBody) {
      console.log(`  POST body captured in memory: ${postBody.length} bytes`);
      const postHit = hits.find((h) => h.action === "captured-post");
      console.log(`  POST content-encoding=${postHit?.contentEncoding} content-type=${postHit?.contentType} accept=${postHit?.accept}`);
      try {
        const decoded = postHit?.contentEncoding === "zstd"
          ? zlib.zstdDecompressSync(postBody)
          : postBody;
        const parsed = JSON.parse(decoded.toString("utf8"));
        console.log(`  POST top-level keys: ${Object.keys(parsed).join(", ")}`);
        console.log(`  POST input types: ${(parsed.input ?? []).map((item) => item?.type ?? item?.role ?? typeof item).join(", ")}`);
        console.log(`  POST tools: ${(parsed.tools ?? []).map((tool) => `${tool?.type ?? "?"}:${tool?.name ?? tool?.function?.name ?? "?"}`).join(", ")}`);
        const additional = (parsed.input ?? []).find((item) => item?.type === "additional_tools");
        console.log(`  additional_tools count: ${additional?.tools?.length ?? 0}`);
        console.log(`  additional_tools shapes: ${(additional?.tools ?? []).map((tool) => `${tool?.type ?? "?"}:${tool?.name ?? "?"}[${Object.keys(tool).sort().join("|")}]`).join(", ")}`);
        for (const namespace of additional?.tools ?? []) {
          const names = (namespace.tools ?? []).map((tool) => `${tool?.name ?? "?"}:${tool?.type ?? "function"}[${Object.keys(tool).sort().join("|")}]`);
          console.log(`  ${namespace.name ?? "?"} registry: ${names.join(", ")}`);
        }
        console.log(`  message content types: ${(parsed.input ?? []).filter((item) => item?.type === "message").flatMap((item) => item.content ?? []).map((part) => part?.type ?? typeof part).join(", ")}`);
        console.log(`  text format: ${parsed.text?.format?.type ?? "none"}`);
        const metadata = parsed.client_metadata?.["x-codex-turn-metadata"];
        let metadataKeys = [];
        try { metadataKeys = Object.keys(typeof metadata === "string" ? JSON.parse(metadata) : (metadata ?? {})); } catch {}
        console.log(`  POST turn metadata keys: ${metadataKeys.join(", ")}`);
      } catch { console.log(`  POST body is not JSON`); }
    } else {
      console.log(`  no POST body captured`);
    }
    const wsErrors = (stderr.match(/responses_websocket/g) ?? []).length;
    console.log(`  stderr responses_websocket lines: ${wsErrors}`);
    const firstErr = stderr.split("\n").find((l) => l.includes("ERROR"));
    if (firstErr) console.log(`  first error: ${firstErr.slice(0, 220)}`);
  } finally {
    child.stdin.end();
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("close", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    await new Promise((resolve) => server.close(resolve));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(home, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
}

await run(variant);
