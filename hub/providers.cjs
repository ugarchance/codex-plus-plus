const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { userDataDir } = require("./store.cjs");

const FALLBACKS = Object.freeze({
  "opencode-go": {
    name: "OpenCode Go",
    endpoint: "https://opencode.ai/zen/go/v1",
    protocol: "chat",
    opencode: true,
  },
  "opencode-zen": {
    name: "OpenCode Zen",
    endpoint: "https://opencode.ai/zen/v1",
    protocol: "chat",
    opencode: true,
  },
  openrouter: {
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    protocol: "chat",
  },
  "openai-api": {
    name: "OpenAI API",
    endpoint: "https://api.openai.com/v1",
    protocol: "responses",
  },
  anthropic: {
    name: "Anthropic API",
    endpoint: "https://api.anthropic.com/v1",
    protocol: "anthropic",
  },
  ollama: {
    name: "Ollama",
    endpoint: "http://127.0.0.1:11434/v1",
    protocol: "chat",
    local: true,
  },
  lmstudio: {
    name: "LM Studio",
    endpoint: "http://127.0.0.1:1234/v1",
    protocol: "chat",
    local: true,
  },
  custom: { name: "Custom provider", endpoint: "", protocol: "responses" },
});
function presets() {
  const result = {
    ...FALLBACKS,
    ...require("./provider-registry.cjs").read().providers,
  };
  for (const c of read().connections) {
    result[c.providerId] ??= {name:c.providerId,endpoint:c.endpoint,protocol:c.models[0]?.protocol??'responses',note:'This provider is missing from the current catalog. Your saved connection is preserved.'};
  }
  return result;
}
const PRESETS = new Proxy(
  {},
  {
    get: (_, key) => presets()[key],
    ownKeys: () => Object.keys(presets()),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
);
const EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
let encryption;
function cipher() {
  return encryption ?? require("./provider-secrets.cjs");
}
function location() {
  return path.join(userDataDir(), "providers.json");
}
function read() {
  try {
    const r = JSON.parse(fs.readFileSync(location(), "utf8"));
    if (r.version !== 1 || !Array.isArray(r.connections))
      throw Error("Unsupported providers store");
    return r;
  } catch (e) {
    if (e.code === "ENOENT")
      return { version: 1, connections: [], routes: {}, preferred: {} };
    throw e;
  }
}
function write(data) {
  fs.mkdirSync(userDataDir(), { recursive: true });
  const temp = location() + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, location());
}
function encrypt(value) {
  const c = cipher();
  if (
    !c.isEncryptionAvailable() ||
    c.getSelectedStorageBackend?.() === "basic_text"
  )
    throw Error(
      "The operating system secure key storage service is unavailable.",
    );
  return c.encryptString(value).toString("base64");
}
function secret(connection) {
  return connection.secret
    ? cipher().decryptString(Buffer.from(connection.secret, "base64"))
    : "";
}
function endpoint(value) {
  const u = new URL(String(value));
  if (u.username || u.password || u.search || u.hash)
    throw Error("Endpoint must not contain user information, a query, or a fragment.");
  if (
    u.protocol !== "https:" &&
    !(
      u.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
    )
  )
    throw Error("HTTPS veya yerel HTTP endpoint gerekli.");
  return u.href.replace(/\/$/, "");
}
function cleanText(v, max = 160) {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > max ||
    /[\x00-\x1f]/.test(v)
  )
    throw Error("Invalid text.");
  return v.trim();
}
function model(v) {
  const id = cleanText(v.id, 200);
  const protocol = v.protocol ?? "responses";
  if (!["responses", "chat", "anthropic"].includes(protocol))
    throw Error("Invalid model protocol.");
  const efforts = [...new Set(v.efforts ?? [])];
  if (efforts.some((e) => !EFFORTS.includes(e))) throw Error("Invalid effort.");
  const defaultEffort = v.defaultEffort ?? efforts[0] ?? null;
  if (defaultEffort !== null && !efforts.includes(defaultEffort))
    throw Error("Default effort is unsupported.");
  const contextWindow = Number(v.contextWindow ?? 32768);
  if (
    !Number.isInteger(contextWindow) ||
    contextWindow < 1024 ||
    contextWindow > 4000000
  )
    throw Error("Invalid context window.");
  return {
    id,
    label: cleanText(v.label ?? id),
    protocol,
    efforts,
    defaultEffort,
    enabled: v.enabled === true,
    contextWindow,
    images: v.images === true,
    tools: v.tools !== false,
    requestProfile: v.requestProfile ?? null,
    supported: v.supported !== false,
  };
}
function publicConnection(c) {
  const { secret: _, ...safe } = c;
  return { ...safe, hasKey: !!c.secret };
}
function view() {
  const d = read();
  const registry = require("./provider-registry.cjs").read();
  return {
    version: 1,
    connections: d.connections.map(publicConnection),
    preferred: d.preferred ?? {},
    presets: presets(),
    registry: {
      source: registry.source,
      revision: registry.revision,
      updatedAt: registry.updatedAt,
    },
    efforts: EFFORTS,
  };
}
function save(input) {
  const d = read();
  const old = input.id ? d.connections.find((c) => c.id === input.id) : null;
  if (input.id && !old) throw Error("Connection not found.");
  const preset = PRESETS[input.providerId];
  if (!preset) throw Error("Unknown provider.");
  if (preset.supported === false)
    throw Error(
      "This provider requires a connection adapter that is not yet supported.",
    );
  const url = endpoint(input.endpoint || preset.endpoint);
  const key = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (key.length > 8192 || /[\r\n]/.test(key))
    throw Error("Invalid API key.");
  if (
    old &&
    (old.endpoint !== url || old.providerId !== input.providerId) &&
    old.secret &&
    !key
  )
    throw Error("Enter the key again when changing the endpoint or provider.");
  const encrypted = key ? encrypt(key) : (old?.secret ?? null);
  if (!encrypted && !preset.local && input.providerId !== "custom")
    throw Error("An API key is required.");
  if (!encrypted && new URL(url).protocol !== "http:")
    throw Error("An API key is required for a remote provider.");
  const models = (input.models ?? old?.models ?? []).map(model);
  if (
    models.length > 500 ||
    new Set(models.map((m) => m.id)).size !== models.length
  )
    throw Error("Model list contains duplicate or excessive entries.");
  const changed =
    !old || key || old.endpoint !== url || old.providerId !== input.providerId;
  const c = {
    ...old,
    id: old?.id ?? crypto.randomUUID(),
    providerId: input.providerId,
    label: cleanText(input.label || preset.name),
    endpoint: url,
    secret: encrypted,
    enabled: input.enabled !== false,
    models,
    status: changed ? "untested" : old.status,
    checkedAt: changed ? null : old.checkedAt,
    usage: old?.usage ?? null,
  };
  d.connections = old
    ? d.connections.map((e) => (e.id === c.id ? c : e))
    : [...d.connections, c];
  write(d);
  return view();
}
function remove(id) {
  const d = read();
  if (!ID.test(id)) throw Error("Invalid connection.");
  d.connections = d.connections.filter((c) => c.id !== id);
  for (const [p, c] of Object.entries(d.preferred ?? {}))
    if (c === id) delete d.preferred[p];
  write(d);
  return view();
}
function update(id, changes) {
  const d = read();
  const c = d.connections.find((c) => c.id === id);
  if (!c) throw Error("Connection not found.");
  Object.assign(c, changes);
  write(d);
  return c;
}
function select(providerId, id) {
  const d = read();
  if (
    id !== null &&
    !d.connections.some(
      (c) => c.id === id && c.providerId === providerId && c.enabled,
    )
  )
    throw Error("No enabled connection found.");
  (d.preferred ??= {})[providerId] = id;
  write(d);
  return view();
}
function slug(c, m) {
  return "cxp/" + c.providerId + "/" + encodeURIComponent(m.id);
}
function catalog() {
  const rows = new Map();
  for (const c of read().connections) {
    if (!c.enabled || !["ready", "offline"].includes(c.status)) continue;
    for (const m of c.models) {
      if (!m.enabled || m.supported === false) continue;
      const id = slug(c, m);
      const existing = rows.get(id);
      if (existing) {
        existing.connectionIds.push(c.id);
        continue;
      }
      rows.set(id, {
        id,
        model: id,
        displayName: `${m.label} · ${PRESETS[c.providerId]?.name ?? c.providerId}`,
        description: `${PRESETS[c.providerId]?.name ?? c.providerId} / ${m.id}`,
        hidden: false,
        isDefault: false,
        defaultReasoningEffort: m.defaultEffort ?? "medium",
        supportedReasoningEfforts: m.efforts.map((reasoningEffort) => ({
          reasoningEffort,
          description: "",
        })),
        inputModalities: m.images ? ["text", "image"] : ["text"],
        supportsPersonality: false,
        connectionIds: [c.id],
        contextWindow: m.contextWindow,
      });
    }
  }
  return [...rows.values()];
}
function choose(modelId, threadId) {
  const d = read();
  const pinned = threadId ? d.routes?.[threadId] : null;
  const candidates = d.connections.filter(
    (c) =>
      c.enabled &&
      c.status === "ready" &&
      (!c.cooldownUntil || c.cooldownUntil < Date.now()) &&
      c.models.some(
        (m) => m.enabled && m.supported !== false && slug(c, m) === modelId,
      ),
  );
  let c = pinned ? candidates.find((c) => c.id === pinned.connectionId) : null;
  if (pinned && !c)
    throw Error(
      "This chat connection is disabled or unavailable. Check provider settings.",
    );
  if (!c) {
    const p = candidates[0]?.providerId;
    const preferred = d.preferred?.[p];
    if (preferred) {
      c = candidates.find((c) => c.id === preferred);
      if (!c) throw Error("The selected connection is unavailable for this model.");
    } else
      c = candidates.sort(
        (a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0),
      )[0];
  }
  if (!c) throw Error("No enabled and verified connection is available for this model.");
  return {
    connection: c,
    model: c.models.find(
      (m) => m.enabled && m.supported !== false && slug(c, m) === modelId,
    ),
  };
}
function bind(threadId, connectionId, modelId) {
  const d = read();
  (d.routes ??= {})[threadId] = { connectionId, modelId };
  write(d);
}
module.exports = {
  model,
  encrypt,
  PRESETS,
  EFFORTS,
  read,
  view,
  save,
  remove,
  select,
  update,
  catalog,
  choose,
  bind,
  secret,
  slug,
  endpoint,
  location,
  setEncryptionForTests: (c) => {
    encryption = c;
  },
};
