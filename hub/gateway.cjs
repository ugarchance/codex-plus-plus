const crypto = require("node:crypto");
const http = require("node:http");
const zlib = require("node:zlib");
const { Readable } = require("node:stream");

const contract = require("./web-contract.cjs");
const broker = require("./turn-broker.cjs");
const httpRounds = require("./web-http-rounds.cjs");
const { ResponseStreamWriter } = require("./responses-stream.cjs");

const UPSTREAM = "https://chatgpt.com/backend-api/codex";
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const HEARTBEAT_MS = 2_000;
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer",
  "transfer-encoding", "upgrade", "host", "content-length",
]);

let server = null;
let baseUrl = null;
let generation = 0;

function sha(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function requestPath(requestUrl) {
  return new URL(requestUrl, "http://127.0.0.1").pathname;
}

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
  const options = { maxOutputLength: MAX_REQUEST_BYTES };
  if (normalized === "zstd") return zlib.zstdDecompressSync(body, options);
  if (normalized === "gzip") return zlib.gunzipSync(body, options);
  if (normalized === "br") return zlib.brotliDecompressSync(body, options);
  if (normalized === "deflate") return zlib.inflateSync(body, options);
  if (normalized && normalized !== "identity") throw new Error(`unsupported request content-encoding: ${normalized}`);
  return body;
}

function parseRequest(body, encoding) {
  const decoded = decodeBody(body, encoding);
  if (!decoded) return null;
  return JSON.parse(decoded.toString("utf8"));
}

function mergeHeaderMetadata(req, request) {
  const header = req.headers["x-codex-turn-metadata"];
  if (!header || request?.client_metadata?.["x-codex-turn-metadata"]) return request;
  return {
    ...request,
    client_metadata: { ...request?.client_metadata, "x-codex-turn-metadata": header },
  };
}

async function passthrough(req, res, body, request) {
  const abort = new AbortController();
  req.once("aborted", () => abort.abort());
  const outgoingHeaders = forwardHeaders(req.headers);
  const native = contract.restoreWebCheckpointForNative(request);
  if (native !== request) {
    body = Buffer.from(JSON.stringify(native));
    delete outgoingHeaders['content-encoding'];
    outgoingHeaders['content-type'] = 'application/json';
  }
  const upstream = await fetch(upstreamUrl(req.url), {
    method: req.method,
    headers: outgoingHeaders,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    redirect: "manual",
    signal: abort.signal,
  });
  const headers = {};
  for (const [name, value] of upstream.headers.entries()) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
  }
  // Reference server.modelsRequest: refresh the native manager's catalog too,
  // not merely the renderer picker. Native rows and authentication stay intact.
  if (req.method === 'GET' && requestPath(req.url) === '/backend-api/codex/models' && upstream.ok) {
    const chunks = []; let bytes = 0;
    for await (const chunk of upstream.body ?? []) {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { abort.abort(); throw new Error('Native model catalog exceeded 16 MiB'); }
      chunks.push(Buffer.from(chunk));
    }
    const catalog = require('./web-model-catalog.cjs').augmentCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const json = JSON.stringify(catalog);
    delete headers['content-encoding']; delete headers['content-length'];
    headers['content-type'] = 'application/json';
    headers.etag = `W/"${sha(json)}"`;
    res.writeHead(upstream.status, headers); res.end(json); return;
  }
  res.writeHead(upstream.status, headers);
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

function fail(res, status, message, code = "invalid_request") {
  if (res.headersSent) return false;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code, message } }));
  return true;
}

function sseHead(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
}

function accountKey(req) {
  const account = req.headers["chatgpt-account-id"];
  return typeof account === "string" && account ? sha(account) : "browser-partition";
}

function turnKey(identity) {
  return sha(JSON.stringify({ threadId: identity.threadId, turnId: identity.turnId, epoch: identity.epoch }));
}

function roundKey(request, outputs) {
  return sha(JSON.stringify({
    turn: request?.client_metadata?.["x-codex-turn-metadata"] ?? null,
    outputs: outputs.map(({ callId, result }) => ({ callId, result })),
  }));
}

function hasExecGateway(registry) {
  return registry.some((tool) => tool.kind === "freeform"
    && (tool.wireName === "functions.exec" || tool.wireName === "exec" || tool.name === "exec"));
}

function preserveTurnError(message) {
  const error = new Error(message);
  error.preserveTurn = true;
  return error;
}

function compactionPrompt(compiled) {
  return [
    "Create a concise context checkpoint for the next model. Preserve progress, decisions, constraints, tool evidence, remaining work, and the latest user intent. Do not run tools or continue the task.",
    compiled.text,
  ].join("\n\n");
}

function runCompaction(req, res, request, model, version) {
  contract.parseTurnIdentity(request);
  const key = httpRounds.keyOf({ purpose: 'compaction', version, request }, accountKey(req));
  return httpRounds.observe(key, req, res, (ownerReq, ownerRes) => executeCompaction(ownerReq, ownerRes, request, model, version));
}

async function executeCompaction(req, res, request, model, version) {
  request = require('./web-history.cjs').restore(request);
  const webSession = require("./web-session.cjs");
  const identity = contract.parseTurnIdentity(request);
  const spec = contract.requireWebModel(model, {}, request);
  const sources = broker.activeForThread(identity.threadId);
  const activeSource = sources[0];
  const chatKey = contract.conversationKeyOf(request, model, accountKey(req));
  if (sources.length && (sources.length !== 1 || !spec.harness || activeSource.chatKey !== chatKey || !activeSource.sourceRequest
    || activeSource.activeRound || contract.canonicalSuffix(contract.normalizeInput(activeSource.sourceRequest).records,
      contract.normalizeInput(request).records.filter(item => item.type !== 'compaction_trigger')) === null)) {
    fail(res, 409, 'Active compaction could not prove the exact account, model, context and native tool boundary; source left unchanged', 'active_compaction_unsupported');
    return;
  }
  // Full retained handoff sends only its control instruction; budget that actual
  // outgoing message after source matching, not the unused full-history prompt.
  const compiled = contract.compilePrompt(request, { harness: false, retained: false, compaction: true, compactionControl: spec.harness, preflightBudget: !spec.harness, model });
  const controller = new AbortController();
  let endedByServer = false;
  const cancel = () => {
    if (!endedByServer) controller.abort(new Error("the compaction client disconnected"));
  };
  req.once("aborted", cancel);
  res.once("close", () => { if (!endedByServer && !res.writableEnded) cancel(); });

  const runBrowser = () => {
    const options = { key: spec.harness ? contract.conversationKeyOf(request, model, accountKey(req)) : null,
      identity, prompt: spec.harness ? compiled.text : compactionPrompt(compiled), images: compiled.images,
      effortIndex: spec.effortIndex, harness: false, signal: controller.signal,
      activeSource, compactionRequest: request };
    return spec.harness ? require('./web-compaction.cjs').run(webSession, options, compiled) : webSession.runTurn(options);
  };

  if (version === "v1") {
    try {
      const result = await runBrowser();
      const output = contract.buildCompactionReplacement(request, result.text);
      endedByServer = true;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ output }));
    } catch (error) {
      endedByServer = true;
      fail(res, /cancel|disconnect/i.test(error.message) ? 499 : 502, error.message, "compaction_failed");
    }
    return;
  }

  sseHead(res);
  const writer = new ResponseStreamWriter(res, { model, promptCacheKey: identity.promptCacheKey });
  writer.created();
  const heartbeat = setInterval(() => writer.heartbeat({ phase: "compaction" }), HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    const result = await runBrowser();
    writer.compaction(result.text);
    writer.completed(contract.estimateUsage(request,writer.output));
  } catch (error) {
    if (process.env.CODEXPP_GATEWAY_TRACE_IDS === "1") {
      console.error('==> codexpp gateway compaction failed (payload withheld)');
    }
    if (/timeout|deadline|partial/i.test(error.message)) writer.incomplete(error.message);
    else writer.failed(error.message);
  } finally {
    clearInterval(heartbeat);
    endedByServer = true;
    res.end();
  }
}

function serveWebModel(req, res, request, model) {
  contract.parseTurnIdentity(request);
  const key = httpRounds.keyOf(request, accountKey(req));
  return httpRounds.observe(key, req, res, (ownerReq, ownerRes) => executeWebRound(ownerReq, ownerRes, request, model));
}

async function executeWebRound(req, res, request, model) {
  request = require('./web-history.cjs').restore(request);
  const webSession = require("./web-session.cjs");
  const identity = contract.parseTurnIdentity(request);
  const spec = contract.requireWebModel(model, {}, request);
  const registry = contract.extractToolRegistry(request);
  const outputs = contract.extractToolOutputs(request);
  const key = turnKey(identity);
  const chatKey = contract.conversationKeyOf(request, model, accountKey(req));
  if (process.env.CODEXPP_GATEWAY_TRACE_IDS === "1") {
    console.log(`==> codexpp gateway identity thread=${sha(identity.threadId).slice(0, 8)} turn=${sha(identity.turnId).slice(0, 8)} context=${sha(identity.contextWindowId ?? "none").slice(0, 8)} epoch=${sha(identity.epoch).slice(0, 8)} outputs=${outputs.length}`);
    for (const output of outputs) {
      const first = output.result?.content?.[0];
      const parts = (output.result?.content ?? []).map((part) => `${part?.type ?? "?"}:${typeof part?.text === "string" ? part.text.length : 0}:${typeof part?.text === "string" && part.text.includes("__CODEXPP_NATIVE_RESULT_V2__")}`).join(",");
      console.log(`==> codexpp gateway output shape keys=${Object.keys(output.result ?? {}).sort().join("|")} content=${output.result?.content?.length ?? 0} first=${first?.type ?? "none"} parts=${parts}`);
    }
  }

  if (spec.harness && registry.length === 0) {
    throw new Error("Full ChatGPT Web mode requires callable native tools advertised by this Codex turn");
  }

  sseHead(res);
  const writer = new ResponseStreamWriter(res, { model, promptCacheKey: identity.promptCacheKey });
  writer.created();
  const controller = new AbortController();
  let endedByServer = false;
  let turn = null;
  let race;
  let unsubscribe = () => {};
  const disconnect = () => {
    if (endedByServer) return;
    controller.abort(new Error("the native HTTP client disconnected"));
    if (spec.harness) broker.end(key, "the native HTTP client disconnected");
    else race?.cancel?.("the native HTTP client disconnected");
  };
  req.once("aborted", disconnect);
  res.once("close", () => { if (!endedByServer && !res.writableEnded) disconnect(); });
  const heartbeat = setInterval(() => {
    const snapshot = spec.harness ? broker.snapshot(key) : null;
    writer.heartbeat({ phase: snapshot?.activeRound ? "native-tool" : "browser", activeTools: snapshot?.calls?.dispatched ?? 0 });
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    const brokerStatus = spec.harness ? broker.status(key) : { state: "unknown" };
    if (spec.harness && brokerStatus.state === "closed") {
      const completed=httpRounds.completedAnswer(key,request,chatKey);
      if(completed){
        writer.textDelta(completed.text,{phase:'final_answer'});writer.finishMessage();
        writer.completed(contract.estimateUsage(request,writer.output));
        return;
      }
      throw preserveTurnError(`this logical user turn is already terminal and will not be replayed: ${brokerStatus.reason}`);
    }
    if (spec.harness && brokerStatus.state === "active") {
      turn = broker.get(key);
      if (!outputs.length) {
        throw preserveTurnError("this logical user turn already has an active HTTP/browser owner; the retry was not resubmitted");
      }
      const contextUpdates=contract.runtimeContextUpdates(turn.sourceRequest,request);
      const statuses = broker.deliverOutputs(key, outputs.filter(output => !turn.historicalCallIds?.has(output.callId)),{contextUpdates});
      const rejected = statuses.filter((status) => !["accepted", "duplicate"].includes(status.status));
      if (rejected.length) {
        throw preserveTurnError(`native tool outputs were not accepted: ${rejected.map((item) => `${item.callId}:${item.status}`).join(", ")}`);
      }
      if (!statuses.some((status) => status.status === "accepted")) {
        throw preserveTurnError("this HTTP tool-result round was already accepted and will not be replayed");
      }
      race = turn.browser;
    } else {
      const token = spec.harness
        ? broker.begin(key, {
          threadId: identity.threadId,
          turnId: identity.turnId,
          epoch: identity.epoch,
          registry,
          replace: false,
        }).token
        : null;
      if (spec.harness) broker.get(key).historicalCallIds = new Set(outputs.map(output => output.callId));
      // Validate protocol/context here. The owned browser then validates the actual account,
      // canonical suffix and its budget before any prompt or attachment is submitted.
      const full = contract.compilePrompt(request, { token, retained: false, harness: spec.harness, model, preflightBudget: false });
      if (spec.harness) {
        turn = broker.get(key);
        unsubscribe = broker.subscribeProgress(key, ({ delta, phase }) => writer.textDelta(delta, { phase }));
      }
      race = webSession.runTurn({
        key: chatKey,
        prompt: full.text,
        tail: null,
        images: full.images,
        effortIndex: spec.effortIndex,
        harness: spec.harness,
        token,
        request,
        signal: controller.signal,
        onDelta: spec.harness
          ? (delta) => broker.publishProgress(key, delta, "commentary")
          : (delta) => writer.textDelta(delta, { phase: "commentary" }),
      });
      if (spec.harness) broker.attach(key, race, { cancel: race.cancel });
    }

    if (turn) { turn.sourceRequest = request; turn.chatKey = chatKey; }

    if (spec.harness && turn && brokerStatus.state === "active") {
      unsubscribe = broker.subscribeProgress(key, ({ delta, phase }) => writer.textDelta(delta, { phase }));
    }
    const next = spec.harness
      ? await broker.waitForTool(key, race, { roundId: roundKey(request, outputs) })
      : { done: await race };
    const calls = next.tools ?? (next.tool ? [next.tool] : []);
    if (calls.length) {
      writer.toolCalls(calls);
      writer.completed(contract.estimateUsage(request,writer.output));
    } else {
      const result = next.done;
      writer.finishMessage();
      writer.textDelta(result.text, { phase: "final_answer" });
      writer.finishMessage();
      writer.completed(contract.estimateUsage(request,writer.output));
      webSession.commitContext?.(chatKey, request, writer.output);
      if (spec.harness) httpRounds.rememberCompletion(key,request,chatKey,result.text,writer.output);
      if (spec.harness) broker.end(key);
    }
  } catch (error) {
    if (process.env.CODEXPP_GATEWAY_TRACE_IDS === "1") {
      console.error('==> codexpp gateway turn failed (payload withheld)');
    }
    if (/timeout|deadline/i.test(error.message) && error.preserveTurn !== true) writer.incomplete(error.message);
    else writer.failed(error.message);
    if (spec.harness && error.preserveTurn !== true) broker.end(key, error.message);
  } finally {
    clearInterval(heartbeat);
    unsubscribe();
    endedByServer = true;
    res.end();
  }
}

function handle(req, res) {
  // Rust engine HTTP has no browser Origin. Deny cross-origin/simple-form traffic and DNS rebinding.
  if (req.headers.origin || (req.headers.host && !/^127\.0\.0\.1:\d+$/.test(req.headers.host))) {
    fail(res, 403, 'This loopback endpoint accepts native local engine traffic only', 'local_origin_required');
    req.resume(); return;
  }
  const chunks = [];
  let bytes = 0;
  let rejected = false;
  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      rejected = true;
      fail(res, 413, "Codex++ gateway request exceeded the body limit", "request_too_large");
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("error", () => { if (!res.headersSent) fail(res, 400, "Codex++ gateway could not read the request"); });
  req.on("end", async () => {
    if (rejected) return;
    const body = Buffer.concat(chunks);
    const pathname = requestPath(req.url);
    const isResponses = pathname === "/backend-api/codex/responses";
    const isCompact = pathname === "/backend-api/codex/responses/compact";
    try {
      let request = (isResponses || isCompact) && req.method === "POST"
        ? parseRequest(body, req.headers["content-encoding"])
        : null;
      if (request) request = mergeHeaderMetadata(req, request);
      const model = typeof request?.model === "string" ? request.model : null;
      if (model?.startsWith(contract.WEB_MODEL_PREFIX)) {
        contract.requireWebModel(model, {}, request);
        const compaction = contract.isCompactionRequest(request, pathname);
        if (compaction) await runCompaction(req, res, request, model, compaction);
        else await serveWebModel(req, res, request, model);
        return;
      }
      await passthrough(req, res, body, request);
    } catch (error) {
      console.error("==> codexpp gateway request failed (payload withheld)");
      if (!res.headersSent) fail(res, 400, error.message);
      else res.end();
    }
  });
}

async function start() {
  if (server) return { baseUrl, generation };
  server = http.createServer(handle);
  server.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
  });
  server.on("error", (error) => console.error("==> codexpp gateway:", error.message));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  generation += 1;
  baseUrl = `http://127.0.0.1:${server.address().port}/backend-api/codex`;
  return { baseUrl, generation };
}

async function stop() {
  if (!server) return;
  broker.endAll("the Codex++ gateway stopped");
  httpRounds.stop();
  const closing = server;
  server = null;
  baseUrl = null;
  generation += 1;
  await new Promise((resolve) => closing.close(resolve));
}

function route() {
  return baseUrl;
}

function routeInfo() {
  return { baseUrl, generation, ready: Boolean(server && baseUrl), models: contract.catalogRows(),
    supportedModels: contract.supportedModels(), ...require('./web-model-catalog.cjs').status() };
}

module.exports = {
  start,
  stop,
  route,
  routeInfo,
  handle,
  parseRequest,
  requestPath,
  WEB_MODEL_PREFIX: contract.WEB_MODEL_PREFIX,
};
