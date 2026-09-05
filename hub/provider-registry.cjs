const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { userDataDir } = require("./store.cjs");
const SOURCE = "duolahypercho/codex-router";
const protocols = { "openai-responses": "responses", anthropic: "anthropic" };
function normalize(documents, revision) {
  const raw = documents.flatMap((d) => d.providers ?? []);
  const models = documents.flatMap((d) => d.models ?? []);
  const providers = Object.create(null);
  const aliases = Object.create(null);
  for (const p of raw) {
    if (typeof p.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(p.id))
      throw Error("Invalid catalog provider.");
    let url;
    try {
      url = new URL(p.baseUrl);
    } catch {
      continue;
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      )
    )
      continue;
    const parent = raw.find((x) => x.id === p.variantOf);
    const sameEndpoint =
      parent &&
      parent.baseUrl?.replace(/\/$/, "") === p.baseUrl.replace(/\/$/, "");
    const id = sameEndpoint ? parent.id : p.id;
    aliases[p.id] = id;
    if (sameEndpoint && providers[id]) continue;
    const unsupported =
      p.kind !== "openai-compatible" ||
      !!p.authProfile ||
      !!p.directResponses ||
      !!p.perModelEndpoint ||
      p.authMode === "per-model";
    providers[id] = {
      id,
      name: (sameEndpoint ? parent : p).displayName ?? id,
      endpoint: p.baseUrl.replace(/\/$/, ""),
      protocol: protocols[(sameEndpoint ? parent : p).protocol] ?? "chat",
      local: p.keyless === true,
      opencode: p.ownedBy === "opencode",
      supported: !unsupported,
      note: unsupported
        ? "This connection type requires a dedicated authentication or protocol adapter."
        : (p.planNote ?? ""),
      models: [],
    };
  }
  for (const m of models) {
    const p = providers[aliases[m.provider]];
    if (!p || !m.upstreamModel || m.upstreamModel.length > 200) continue;
    const rawProvider = raw.find((x) => x.id === m.provider);
    if (p.models.some((x) => x.id === m.upstreamModel)) continue;
    const efforts = (m.reasoningLevels ?? [])
      .map((x) => x.effort)
      .filter((x) =>
        ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(
          x,
        ),
      );
    const protocol = protocols[rawProvider.protocol] ?? "chat";
    p.models.push({
      id: m.upstreamModel,
      label: m.displayName ?? m.upstreamModel,
      protocol,
      efforts: protocol === "anthropic" ? [] : efforts,
      defaultEffort:
        protocol === "anthropic"
          ? null
          : efforts.includes(m.defaultEffort)
            ? m.defaultEffort
            : (efforts[0] ?? null),
      contextWindow: m.contextWindow ?? 32768,
      images: m.inputModalities?.includes("image") ?? false,
      tools: true,
      enabled: false,
      supported:
        !m.requestProfile ||
        ["auto-tool-choice", "ox-alpha", "hy4-reasoning", "kimi-k3"].includes(
          m.requestProfile,
        ),
      requestProfile: m.requestProfile ?? null,
    });
  }
  if (Object.keys(providers).length < 5)
    throw Error("Provider catalog is missing.");
  return {
    version: 1,
    source: SOURCE,
    revision,
    updatedAt: Date.now(),
    providers,
  };
}
function read() {
  try {
    const data = JSON.parse(
      fs.readFileSync(
        path.join(userDataDir(), "provider-registry.json"),
        "utf8",
      ),
    );
    if (data.version === 1 && data.source === SOURCE && data.providers)
      return data;
  } catch {}
  return require("./provider-registry.json");
}
function tarDocuments(buffer) {
  const files = [];
  let license;
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((x) => x === 0)) break;
    const str = (a, b) =>
      header.subarray(a, b).toString().replace(/\0.*$/s, "");
    const size = parseInt(str(124, 136).trim(), 8);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 512 + size > buffer.length
    )
      throw Error("Invalid catalog archive.");
    const name = str(0, 100);
    const prefix = str(345, 500);
    const full = prefix ? prefix + "/" + name : name;
    const data = buffer.subarray(offset + 512, offset + 512 + size);
    if (/^[^/]+\/config\/[A-Za-z0-9_./-]+\.json$/.test(full)) {
      if (size > 2 * 1024 * 1024) throw Error("Catalog file is too large.");
      files.push(JSON.parse(data.toString()));
    }
    if (/^[^/]+\/LICENSE$/.test(full)) license = data.toString();
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!license?.startsWith("MIT License"))
    throw Error("The catalog source license has changed; update stopped.");
  return files;
}
async function bounded(url, max) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "CodexPlusPlus-ProviderCatalog",
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(60000),
    redirect: "error",
  });
  if (!r.ok) throw Error("Katalog sunucusu HTTP " + r.status);
  let size = 0;
  const parts = [];
  for await (const part of r.body) {
    size += part.length;
    if (size > max) throw Error("Catalog exceeds the size limit.");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
let refreshing;
function refresh() {
  return (refreshing ??= (async () => {
    const meta = JSON.parse(
      (
        await bounded(
          "https://api.github.com/repos/" + SOURCE + "/commits/main",
          2000000,
        )
      ).toString(),
    );
    if (!/^[a-f0-9]{40}$/.test(meta.sha))
      throw Error("Invalid catalog version.");
    const current = read();
    if (current.revision === meta.sha) return current;
    const archive = await bounded(
      "https://codeload.github.com/" + SOURCE + "/tar.gz/" + meta.sha,
      50 * 1024 * 1024,
    );
    const data = normalize(
      tarDocuments(
        zlib.gunzipSync(archive, { maxOutputLength: 160 * 1024 * 1024 }),
      ),
      meta.sha,
    );
    const target = path.join(userDataDir(), "provider-registry.json");
    fs.mkdirSync(userDataDir(), { recursive: true });
    fs.writeFileSync(target + ".tmp", JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(target + ".tmp", target);
    return data;
  })().finally(() => {
    refreshing = null;
  }));
}
module.exports = { normalize, read, refresh, tarDocuments };
