const store = require("./store.cjs");
const { authClaims } = require("./claims.cjs");

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLOCK_SKEW_MS = 60_000;

const inFlight = new Map();

async function exchange(refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "openid profile email"
    })
  });
  if (!response.ok) {
    throw new Error(`token yenilenemedi: HTTP ${response.status}`);
  }
  return response.json();
}

async function refreshAccount(account) {
  const data = await exchange(account.refreshToken);
  const claims = authClaims(data.access_token);
  return store.updateAccount(account.id, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? account.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    accountId: claims.chatgpt_account_id ?? account.accountId ?? null,
    planType: claims.chatgpt_plan_type ?? account.planType ?? null
  });
}

function selectAccount(data, hostId, params) {
  const byAssignment = data.accounts.find((a) => a.id === data.assignments?.[hostId]);
  if (byAssignment) return byAssignment;

  const previous = params?.previousAccountId;
  const byPrevious = previous && data.accounts.find((a) => a.accountId === previous);
  if (byPrevious) return byPrevious;

  const byDefault = data.accounts.find((a) => a.id === data.defaultAccountId);
  return byDefault ?? data.accounts[0] ?? null;
}

function asResponse(account) {
  if (!account?.accessToken || !account.accountId) return null;
  return {
    accessToken: account.accessToken,
    chatgptAccountId: account.accountId,
    chatgptPlanType: account.planType ?? null
  };
}

async function tokenForHost(hostId, params) {
  const account = selectAccount(store.read(), hostId, params);
  if (!account) return null;

  if (account.accessToken && account.expiresAt - CLOCK_SKEW_MS > Date.now()) {
    return asResponse(account);
  }

  if (!inFlight.has(account.id)) {
    inFlight.set(account.id, refreshAccount(account).finally(() => inFlight.delete(account.id)));
  }
  return asResponse(await inFlight.get(account.id));
}

module.exports = { tokenForHost, refreshAccount };
