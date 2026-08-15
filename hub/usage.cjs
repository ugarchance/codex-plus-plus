const https = require("node:https");
const store = require("./store.cjs");
const tokens = require("./tokens.cjs");

const USAGE_URL = "https://chatgpt.com/backend-api/codex/usage";
const STALE_MS = 60_000;

const inFlight = new Map();

function getJson(url, headers) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: "GET", headers }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`kullanım alınamadı: HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error(`kullanım yanıtı çözülemedi: ${err.message}`));
        }
      });
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchUsage(account) {
  const accessToken = await tokens.accessTokenFor(account);
  if (!accessToken) return null;

  const body = await getJson(USAGE_URL, {
    Authorization: `Bearer ${accessToken}`,
    "ChatGPT-Account-Id": account.accountId ?? "",
    originator: "codex_cli_rs",
    "User-Agent": "codex_cli_rs"
  });
  const window = body?.rate_limit?.primary_window;

  return {
    email: body?.email ?? account.email ?? null,
    planType: body?.plan_type ?? account.planType ?? null,
    usedPercent: typeof window?.used_percent === "number" ? window.used_percent : null,
    resetAt: typeof window?.reset_at === "number" ? window.reset_at * 1000 : null,
    usageAt: Date.now()
  };
}

async function refreshAccount(account, { force = false } = {}) {
  if (!force && account.usageAt && Date.now() - account.usageAt < STALE_MS) return account;

  if (!inFlight.has(account.id)) {
    const task = fetchUsage(account)
      .then((usage) => (usage ? store.updateAccount(account.id, usage) : account))
      .catch((err) => {
        console.error(`==> codexpp kullanım hatası (${account.label}):`, err.message);
        return store.updateAccount(account.id, { usageAt: Date.now(), usedPercent: null }) ?? account;
      })
      .finally(() => inFlight.delete(account.id));
    inFlight.set(account.id, task);
  }
  return inFlight.get(account.id);
}

async function refreshAll(options) {
  await Promise.all(store.read().accounts.map((account) => refreshAccount(account, options)));
  return store.publicView();
}

module.exports = { refreshAll, refreshAccount };
