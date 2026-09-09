const http = require("node:http");
const zlib = require("node:zlib");
const { Readable } = require("node:stream");

const UPSTREAM = "https://chatgpt.com/backend-api/codex";
const WEB_MODEL_PREFIX = "chatgpt-web/";
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length"
]);

let server = null;
let baseUrl = null;

function upstreamUrl(requestUrl) {
  const suffix = requestUrl.replace(/^\/backend-api\/codex/, "");
  return `${UPSTREAM}${suffix}`;
}

function forwardHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    if (value !== undefined) out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function decodeBody(body, encoding) {
  if (!body.length) return null;
  const normalized = (encoding || "").toLowerCase();
  if (normalized === "zstd") return zlib.zstdDecompressSync(body);
  if (normalized === "gzip") return zlib.gunzipSync(body);
  if (normalized === "br") return zlib.brotliDecompressSync(body);
  if (normalized === "deflate") return zlib.inflateSync(body);
  return body;
}

function parseRequest(body, encoding) {
  try {
    const decoded = decodeBody(body, encoding);
    if (!decoded) return null;
    return JSON.parse(decoded.toString("utf8"));
  } catch {
    return null;
  }
}

const WEB_MODELS = {
  "chatgpt-web/instant": { effortIndex: 0, harness: false },
  "chatgpt-web/medium": { effortIndex: 1, harness: false },
  "chatgpt-web/high": { effortIndex: 2, harness: false },
  "chatgpt-web/extra-high": { effortIndex: 3, harness: false },
  "chatgpt-web/pro": { effortIndex: 4, harness: false },
  "chatgpt-web/pro-harness": { effortIndex: 4, harness: true }
};

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function renderMessages(items) {
  const lines = [];
  for (const item of items) {
    if (item?.type !== "message") continue;
    const text = textOf(item.content);
    if (!text.trim()) continue;
    lines.push(item.role === "user" ? text : `[${item.role ?? "context"}]\n${text}`);
  }
  return lines.join("\n\n").trim();
}

function promptFrom(request) {
  return renderMessages(Array.isArray(request?.input) ? request.input : []);
}

// A harness turn gets the user's own messages only; Codex's developer preamble is about its own
// tool protocol and buries the instruction that matters.
function userPromptFrom(request) {
  const items = Array.isArray(request?.input) ? request.input : [];
  return renderMessages(items.filter((item) => item?.role === "user")) || promptFrom(request);
}

// Codex replays the whole conversation on every turn; a reused ChatGPT chat only needs what came
// after its last answer.
function tailFrom(request) {
  const items = Array.isArray(request?.input) ? request.input : [];
  const last = items.findLastIndex((item) => item?.type === "message" && item.role === "assistant");
  if (last < 0 || last === items.length - 1) return null;
  const rest = items.slice(last + 1);
  // Codex re-injects its developer preamble every turn; an open chat has already read it.
  const fresh = rest.filter((item) => item?.role === "user");
  return renderMessages(fresh.length ? fresh : rest) || null;
}

function conversationKeyOf(request, model) {
  const thread = request?.prompt_cache_key;
  return typeof thread === "string" && thread ? `${model}|${thread}` : null;
}

async function passthrough(req, res, body) {
  const upstream = await fetch(upstreamUrl(req.url), {
    method: req.method,
    headers: forwardHeaders(req.headers),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    redirect: "manual"
  });

  const headers = {};
  for (const [name, value] of upstream.headers.entries()) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
  }
  res.writeHead(upstream.status, headers);
  if (!upstream.body) {
    res.end();
    return;
  }

  const capture = process.env.CODEXPP_GATEWAY_CAPTURE;
  if (capture && req.url.includes("/responses")) {
    const sink = require("node:fs").createWriteStream(capture, { flags: "a" });
    const stream = Readable.fromWeb(upstream.body);
    stream.on("data", (chunk) => sink.write(chunk));
    stream.on("end", () => sink.end());
    stream.pipe(res);
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

function fail(res, status, message) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message } }));
}

function toolResultFrom(request) {
  const items = Array.isArray(request?.input) ? request.input : [];
  const done = items.findLast((item) => item?.type === "custom_tool_call_output");
  if (!done) return null;
  const text = typeof done.output === "string"
    ? done.output
    : (Array.isArray(done.output) ? done.output : [])
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("");
  return { callId: done.call_id, text: text.trim() };
}

function sseHead(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
}

// Proves the code-mode round trip without the browser: inject one `exec` call, then answer with
// whatever Codex ran locally.
async function serveHarnessProbe(res, request, model) {
  const stream = require("./responses-stream.cjs");
  const promptCacheKey = request?.prompt_cache_key;
  const result = toolResultFrom(request);
  sseHead(res);

  if (!result) {
    const callId = `call_${require("node:crypto").randomBytes(16).toString("hex")}`;
    const source = 'const r = await tools.exec_command({"cmd":"echo codexpp-harness-ok","workdir":"/tmp","yield_time_ms":10000,"max_output_tokens":1000});\ntext(r.output);\n';
    console.log(`==> codexpp harness probe: exec çağrısı gönderildi call_id=${callId}`);
    for (const frame of stream.toolCall({ model, promptCacheKey, callId, source })) res.write(frame);
  } else {
    console.log(`==> codexpp harness probe: tool çıktısı alındı ${JSON.stringify(result.text.slice(0, 120))}`);
    for (const frame of stream.events({ model, promptCacheKey, text: `tool output: ${result.text}` })) res.write(frame);
  }
  res.end();
}

async function serveWebModel(res, request, model) {
  if (process.env.CODEXPP_HARNESS_PROBE) {
    await serveHarnessProbe(res, request, model);
    return;
  }

  const stream = require("./responses-stream.cjs");
  const broker = require("./turn-broker.cjs");
  const promptCacheKey = request?.prompt_cache_key;
  const key = (WEB_MODELS[model]?.harness ? conversationKeyOf(request, model) : null);
  const chatKey = conversationKeyOf(request, model);
  const result = key ? toolResultFrom(request) : null;
  const resuming = Boolean(result && broker.get(key));

  let race;
  if (resuming) {
    broker.deliverOutput(key, result.callId, result.text);
    race = broker.get(key).browser;
  } else {
    const harness = WEB_MODELS[model]?.harness === true;
    const prompt = harness ? userPromptFrom(request) : promptFrom(request);
    if (!prompt) {
      fail(res, 400, "codexpp gateway could not build a prompt from the request");
      return;
    }
    const webSession = require("./web-session.cjs");
    const spec = WEB_MODELS[model] ?? { effortIndex: null, harness: false };
    const turn = key && spec.harness ? broker.begin(key) : null;
    race = webSession.runTurn({
      key: chatKey,
      prompt,
      tail: tailFrom(request),
      effortIndex: spec.effortIndex,
      harness: spec.harness,
      token: turn?.token ?? null
    });
    if (turn) broker.attach(key, race);
  }

  sseHead(res);
  try {
    const next = key ? await broker.waitForTool(key, race) : { done: await race };
    if (next.tool) {
      console.log(`==> codexpp gateway ${model}: exec çağrısı iletildi call_id=${next.tool.callId}`);
      for (const frame of stream.toolCall({ model, promptCacheKey, callId: next.tool.callId, source: next.tool.source })) {
        res.write(frame);
      }
    } else {
      const { text, effort, reused, chars, plugin } = next.done;
      const pluginNote = plugin ? ` plugin=${JSON.stringify(plugin)}` : "";
      console.log(`==> codexpp gateway ${model}: ${reused ? "reused" : "new"} chat, sent=${chars} effort=${JSON.stringify(effort)}${pluginNote} chars=${text.length}`);
      for (const frame of stream.events({ model, promptCacheKey, text })) res.write(frame);
      if (key) broker.end(key);
    }
  } catch (err) {
    console.error("==> codexpp gateway web turn failed:", err.message);
    if (key) broker.end(key, err.message);
    res.write(stream.failure({ message: err.message }));
  }
  res.end();
}

function handle(req, res) {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("error", () => fail(res, 400, "codexpp gateway could not read the request"));
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    try {
      const isResponses = req.url.startsWith("/backend-api/codex/responses");
      const request = isResponses && req.method === "POST"
        ? parseRequest(body, req.headers["content-encoding"])
        : null;
      const model = typeof request?.model === "string" ? request.model : null;

      const dump = process.env.CODEXPP_GATEWAY_CAPTURE_REQUEST;
      if (dump && request) {
        require("node:fs").appendFileSync(dump, `${JSON.stringify(request)}\n`);
      }

      if (model && model.startsWith(WEB_MODEL_PREFIX)) {
        await serveWebModel(res, request, model);
        return;
      }

      await passthrough(req, res, body);
    } catch (err) {
      console.error("==> codexpp gateway request failed:", err.message);
      if (!res.headersSent) fail(res, 502, "codexpp gateway could not reach the upstream");
      else res.end();
    }
  });
}

async function start() {
  if (server) return { baseUrl };

  server = http.createServer(handle);
  // The engine opens /responses as a WebSocket first; 426 is what makes it fall back to HTTP+SSE.
  server.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
  });
  server.on("error", (err) => console.error("==> codexpp gateway:", err.message));

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}/backend-api/codex`;
  return { baseUrl };
}

async function stop() {
  if (!server) return;
  const closing = server;
  server = null;
  baseUrl = null;
  await new Promise((resolve) => closing.close(resolve));
}

function route() {
  return baseUrl;
}

module.exports = { start, stop, route, WEB_MODEL_PREFIX };
