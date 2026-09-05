const providers = require("./providers.cjs");

// Payload contract verified against codex-router's Go usage adapter (MIT).
function goMetrics(payload) {
  const result = [];
  for (const [key, label] of [
    ["rolling", "Rolling remaining"],
    ["weekly", "Weekly remaining"],
    ["monthly", "Monthly remaining"],
  ]) {
    const detail = payload?.usage?.[key];
    if (
      detail?.percent === null ||
      detail?.percent === undefined ||
      detail.percent === ""
    )
      continue;
    const percent = Number(detail.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) continue;
    result.push({
      label,
      remainingPercent: 100 - percent,
      resetAt: detail.resetsAt ?? detail.reset_at ?? null,
    });
  }
  return result;
}

async function refresh(fetchImpl = fetch) {
  await Promise.all(
    providers
      .read()
      .connections.filter((c) => c.enabled)
      .map(async (c) => {
        if (
          c.providerId !== "opencode-go" ||
          c.endpoint !== "https://opencode.ai/zen/go/v1"
        )
          return;
        let quota;
        try {
          const key = providers.secret(c);
          const response = await fetchImpl(c.endpoint + "/usage", {
            headers: {
              Authorization: "Bearer " + key,
              "User-Agent": "CodexPlusPlus/1.0",
              "x-opencode-session": "codexpp-usage",
            },
            signal: AbortSignal.timeout(15000),
            redirect: "error",
          });
          if (!response.ok) throw Error("HTTP " + response.status);
          const metrics = goMetrics(await response.json());
          if (!metrics.length) throw Error("Unknown usage payload");
          quota = {
            status: "available",
            source: "provider-api",
            updatedAt: Date.now(),
            metrics,
          };
        } catch {
          quota = {
            status: "unavailable",
            source: "provider-api",
            updatedAt: Date.now(),
            metrics: [],
          };
        }
        // A connection may have been deleted while the read-only request was in flight.
        const current = providers.read().connections.find((x) => x.id === c.id);
        if (current?.endpoint === c.endpoint && current.secret === c.secret)
          providers.update(c.id, { quota });
      }),
  );
}
module.exports = { goMetrics, refresh };
