const http = require("node:http");
const crypto = require("node:crypto");
const providers = require("./providers.cjs");
const wire = require("./provider-wire.cjs");
let server, ready;
const tickets = new Map();
const localKey = crypto.randomBytes(32).toString("hex");
process.env.CODEXPP_GATEWAY_KEY = localKey;
function headers(c, session, protocol) {
  const key = providers.secret(c);
  const h = {
    "Content-Type": "application/json",
    "User-Agent": "CodexPlusPlus/1.0",
    Accept: "application/json",
  };
  if (key) {
    if (protocol === "anthropic") h["x-api-key"] = key;
    else h.Authorization = "Bearer " + key;
  }
  if (protocol === "anthropic") h["anthropic-version"] = "2023-06-01";
  if (providers.PRESETS[c.providerId]?.opencode)
    h["x-opencode-session"] = session;
  return h;
}
async function discover(id) {
  const c = providers.read().connections.find((c) => c.id === id);
  if (!c) throw Error("Connection not found.");
  try {
    const r = await fetch(c.endpoint + "/models", {
      headers: headers(
        c,
        "codexpp-model-discovery",
        c.providerId === "anthropic" ? "anthropic" : "responses",
      ),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!r.ok) throw Error("Model list request failed: HTTP " + r.status);
    const data = await r.json();
    const list = data.data ?? data.models;
    if (!Array.isArray(list) || list.length > 5000)
      throw Error("Invalid model list.");
    const preset = providers.PRESETS[c.providerId] ?? {};
    const curated = preset.models ?? [];
    const old = new Map(c.models.map((m) => [m.id, m]));
    const seen = new Set();
    const models = [];
    for (const item of list.slice(0, 500)) {
      const modelId = String(item.id ?? item.name ?? "");
      if (!modelId || modelId.length > 200 || seen.has(modelId)) continue;
      seen.add(modelId);
      const previous = old.get(modelId);
      const known = curated.find((k) => k.id === modelId);
      const definition = {
        id: modelId,
        label: String(item.name ?? modelId).slice(0, 160),
        protocol: preset.protocol ?? "responses",
        efforts: [],
        defaultEffort: null,
        contextWindow: item.context_length ?? 32768,
        images: false,
        tools: true,
        ...previous,
        ...known,
        enabled: previous?.enabled === true,
      };
      if (
        previous?.defaultEffort &&
        definition.efforts.includes(previous.defaultEffort)
      )
        definition.defaultEffort = previous.defaultEffort;
      models.push(providers.model(definition));
    }
    // A delayed discovery must not overwrite a changed/deleted connection or its key.
    const current = providers.read().connections.find((x) => x.id === id);
    if (
      !current ||
      current.endpoint !== c.endpoint ||
      current.secret !== c.secret
    )
      throw Error("Connection changed during validation.");
    providers.update(id, {
      models,
      status: "ready",
      checkedAt: Date.now(),
      lastError: null,
      cooldownUntil: null,
    });
    return providers.view();
  } catch (e) {
    if (providers.read().connections.some((x) => x.id === id))
      providers.update(id, {
        status: "offline",
        checkedAt: Date.now(),
        lastError: e.message.startsWith("Model")
          ? e.message
          : "Connection validation failed.",
      });
    throw Error(
      "Unable to reach the provider. Check the endpoint and API key.",
    );
  }
}
function fail(res, status, message) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "provider_error", message } })}\n\n`,
    );
    res.end();
  } else {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { type: "provider_error", message } }));
  }
}
async function serve(req, res) {
  if (req.headers.origin || req.headers.authorization !== "Bearer " + localKey)
    return fail(res, 401, "Invalid local connection credentials.");
  const match = /^\/route\/([a-f0-9]{32})\/v1\/responses$/.exec(req.url);
  if (req.method !== "POST" || !match)
    return fail(res, 404, "Bu endpoint desteklenmiyor.");
  const ticket = tickets.get(match[1]);
  if (!ticket)
    return fail(res, 410, "Chat route expired; reopen the chat.");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5 * 60 * 1000);
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 24 * 1024 * 1024) throw Error("Request is too large.");
      chunks.push(chunk);
    }
    const p = JSON.parse(Buffer.concat(chunks));
    if (typeof p.model !== 'string' || p.model.split('/').slice(0,2).join('/') !== ticket.modelId.split('/').slice(0,2).join('/'))
      throw Error("Start a new chat to switch providers.");
    const { connection: c, model: m } = providers.choose(
      p.model,
      ticket.threadId,
    );
    if (c.id !== ticket.connectionId)
      throw Error("Connection changed; reopen the chat.");
    if (p.model !== ticket.modelId && (m.protocol !== ticket.protocol || m.protocol === 'anthropic' || m.contextWindow < ticket.contextWindow))
      throw Error('This model has a different protocol or context window; start a new chat.');
    if (
      p.reasoning?.effort &&
      m.efforts.length &&
      !m.efforts.includes(p.reasoning.effort)
    )
      throw Error("Model bu eforu desteklemiyor.");
    if (!m.tools && p.tools?.length)
      throw Error("This model does not support tools.");
    const body =
      m.protocol === "responses"
        ? { ...p, model: m.id }
        : m.protocol === "chat"
          ? wire.chatRequest(p, m)
          : wire.anthropicRequest(p, m);
    if (m.protocol === "responses" && !m.efforts.length) delete body.reasoning;
    const suffix =
      m.protocol === "responses"
        ? "/responses"
        : m.protocol === "chat"
          ? "/chat/completions"
          : "/messages";
    const upstream = await fetch(c.endpoint + suffix, {
      method: "POST",
      headers: headers(c, ticket.threadId ?? ticket.session, m.protocol),
      body: JSON.stringify(body),
      signal: abort.signal,
      redirect: "error",
    });
    if (!upstream.ok) {
      if (
        upstream.status === 429 ||
        upstream.status === 401 ||
        upstream.status === 403
      )
        providers.update(c.id, {
          cooldownUntil:
            Date.now() + (upstream.status === 429 ? 60000 : 300000),
          lastError: "HTTP " + upstream.status,
        });
      return fail(
        res,
        502,
        "Provider returned HTTP " +
          upstream.status +
          ". Check the connection and quota.",
      );
    }
    let usage;
    if (m.protocol === "responses") {
      if (!upstream.headers.get("content-type")?.includes("text/event-stream"))
        throw Error("Provider did not return a Responses stream.");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
      });
      let completed = false;
      for await (const e of wire.sse(upstream.body)) {
        if (e.type === "response.completed") {
          completed = true;
          usage = e.response?.usage;
        }
        res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      }
      if (!completed) throw Error("Provider response did not complete.");
      res.end();
    } else usage = await wire.translateStream(upstream, res, m.protocol, p);
    const latest = providers.read().connections.find((x) => x.id === c.id);
    if (!latest) return;
    ticket.modelId = p.model;
    if (ticket.threadId) providers.bind(ticket.threadId, c.id, p.model);
    providers.update(c.id, {
      lastUsedAt: Date.now(),
      lastError: null,
      usage: {
        source: "local-observed",
        updatedAt: Date.now(),
        requests: (latest.usage?.requests ?? 0) + 1,
        inputTokens:
          (latest.usage?.inputTokens ?? 0) + (usage?.input_tokens ?? 0),
        outputTokens:
          (latest.usage?.outputTokens ?? 0) + (usage?.output_tokens ?? 0),
        metered: !!usage,
      },
    });
  } catch (e) {
    fail(
      res,
      502,
      abort.signal.aborted
        ? "Provider request was canceled or timed out."
        : /^(Provider |This |Model |Request |Unsupported |Invalid |Connection |Chat |Incomplete |Custom |Tool |Start a new chat)/.test(
              e.message,
            )
          ? e.message
          : "Provider request could not be completed.",
    );
  } finally {
    clearTimeout(timer);
  }
}
function start() {
  return (ready ??= (async () => {
    server = http.createServer((req, res) =>
      serve(req, res).catch(() => fail(res, 500, "Provider gateway error.")),
    );
    server.requestTimeout = 300000;
    await new Promise((r, j) => {
      server.once("error", j);
      server.listen(0, "127.0.0.1", r);
    });
    server.unref();
    return server.address().port;
  })());
}
async function prepare(modelId, threadId) {
  const { connection, model } = providers.choose(modelId, threadId);
  const port = await start();
  const token = crypto.randomBytes(16).toString("hex");
  tickets.set(token, {
    modelId,
    protocol: model.protocol,
    contextWindow: model.contextWindow,
    connectionId: connection.id,
    threadId,
    session: crypto.randomUUID(),
  });
  return {
    ticket: token,
    connectionId: connection.id,
    modelProvider: "cxp-external",
    config: {
      "model_providers.cxp-external": {
        name: "Codex++ Providers",
        base_url: `http://127.0.0.1:${port}/route/${token}/v1`,
        wire_api: "responses",
        env_key: "CODEXPP_GATEWAY_KEY",
        requires_openai_auth: false,
        request_max_retries: 0,
        stream_max_retries: 0,
      },
      model_context_window: model.contextWindow,
      model_auto_compact_token_limit: Math.floor(model.contextWindow * 0.8),
      model_reasoning_effort: model.defaultEffort ?? "medium",
      model_supports_reasoning_summaries: false,
      // OpenAI's hosted web_search is not a Chat/Messages function tool.
      ...(model.protocol !== 'responses' ? { web_search: 'disabled' } : {}),
    },
  };
}
function bind(ticket, threadId) {
  const route = tickets.get(ticket);
  if (!route) throw Error("Route not found.");
  route.threadId = threadId;
  providers.bind(threadId, route.connectionId, route.modelId);
}
function stop() {
  server?.closeAllConnections();
  server?.close();
  server = null;
  ready = null;
  tickets.clear();
}
module.exports = { start, prepare, bind, stop, discover, headers };
