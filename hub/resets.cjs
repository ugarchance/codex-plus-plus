const store = require("./store.cjs");
const tokens = require("./tokens.cjs");

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ERROR_CACHE_TTL_MS = 1 * 60 * 1000; // 1 minute
const ENDPOINT_CREDITS = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const ENDPOINT_CONSUME = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume";

const cache = new Map();
const inFlight = new Map();
let customFetch = null;

function getFetch() {
  return customFetch || globalThis.fetch;
}

function setFetch(fn) {
  customFetch = fn;
}

function clearCache(accountId) {
  if (accountId) {
    cache.delete(accountId);
  } else {
    cache.clear();
  }
}

async function creditsFor(accountId, { force = false, fetchImpl } = {}) {
  const account = store.findAccount(accountId);
  if (!account || account.enabled === false || account.disabled === true) {
    throw new Error("account not found or disabled");
  }

  const cached = cache.get(accountId);
  const now = Date.now();
  if (!force && cached) {
    if (cached.error && now - cached.timestamp < ERROR_CACHE_TTL_MS) {
      throw new Error(cached.error);
    }
    if (cached.data && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  if (!inFlight.has(accountId)) {
    inFlight.set(
      accountId,
      (async () => {
        try {
          const accessToken = await tokens.accessTokenFor(account);
          if (!accessToken) {
            throw new Error(`no access token available for account ${accountId}`);
          }

          const headers = {
            "Authorization": `Bearer ${accessToken}`,
            "User-Agent": "Codex Subscription Router",
            "Accept": "application/json"
          };
          if (account.accountId) {
            headers["ChatGPT-Account-ID"] = account.accountId;
          }

          const f = fetchImpl || getFetch();
          const response = await f(ENDPOINT_CREDITS, {
            method: "GET",
            headers
          });

          if (!response.ok) {
            throw new Error(`wham credits fetch failed: HTTP ${response.status}`);
          }

          const data = await response.json();
          cache.set(accountId, { timestamp: Date.now(), data, error: null });
          return data;
        } catch (err) {
          cache.set(accountId, { timestamp: Date.now(), data: null, error: err.message });
          throw err;
        } finally {
          inFlight.delete(accountId);
        }
      })()
    );
  }

  return inFlight.get(accountId);
}

async function consumeCredit(accountId, creditId, redeemRequestId, { fetchImpl } = {}) {
  const account = store.findAccount(accountId);
  if (!account || account.enabled === false || account.disabled === true) {
    throw new Error("account not found or disabled");
  }

  if (!redeemRequestId || typeof redeemRequestId !== "string" || redeemRequestId.trim().length === 0 || redeemRequestId.length > 200) {
    throw new Error("redeemRequestId is required and must be a non-empty string <= 200 characters");
  }

  if (!creditId || typeof creditId !== "string" || creditId.trim().length === 0 || creditId.length > 500) {
    throw new Error("creditId is required and must be a non-empty string <= 500 characters");
  }

  const accessToken = await tokens.accessTokenFor(account);
  if (!accessToken) {
    throw new Error(`no access token available for account ${accountId}`);
  }

  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "Codex Subscription Router",
    "Accept": "application/json"
  };
  if (account.accountId) {
    headers["ChatGPT-Account-ID"] = account.accountId;
  }

  const f = fetchImpl || getFetch();
  const response = await f(ENDPOINT_CONSUME, {
    method: "POST",
    headers,
    body: JSON.stringify({
      credit_id: creditId,
      redeem_request_id: redeemRequestId
    })
  });

  if (!response.ok) {
    throw new Error(`wham consume credit failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  cache.delete(accountId);
  return data;
}

module.exports = {
  creditsFor,
  consumeCredit,
  setFetch,
  clearCache,
  CACHE_TTL_MS,
  ERROR_CACHE_TTL_MS
};
