const store = require("./store.cjs");
const native = require("./native.cjs");
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
    throw new Error(`token refresh failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function refreshAccount(account) {
  const data = await exchange(account.refreshToken);
  const claims = authClaims(data.access_token);

  if (account.native) {
    return native.writeTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? account.refreshToken
    });
  }

  return store.updateAccount(account.id, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? account.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    accountId: claims.chatgpt_account_id ?? account.accountId ?? null,
    planType: claims.chatgpt_plan_type ?? account.planType ?? null
  });
}

function selectAccount(data, hostId, params) {
  const list = store.accounts(data);

  const byAssignment = list.find((a) => a.id === data.assignments?.[hostId]);
  if (byAssignment) return byAssignment;

  const previous = params?.previousAccountId;
  const byPrevious = previous && list.find((a) => a.accountId === previous);
  if (byPrevious) return byPrevious;

  const byActive = list.find((a) => a.id === store.activeAccountId(data));
  if (byActive) return byActive;

  return list.find((a) => a.id === data.defaultAccountId) ?? list[0] ?? null;
}

function asResponse(account) {
  if (!account?.accessToken || !account.accountId) return null;
  return {
    accessToken: account.accessToken,
    chatgptAccountId: account.accountId,
    chatgptPlanType: account.planType ?? null
  };
}

async function fresh(account) {
  if (account.accessToken && account.expiresAt - CLOCK_SKEW_MS > Date.now()) return account;
  if (!account.refreshToken) return null;

  if (!inFlight.has(account.id)) {
    inFlight.set(account.id, refreshAccount(account).finally(() => inFlight.delete(account.id)));
  }
  return inFlight.get(account.id);
}

async function accessTokenFor(account) {
  if (!account?.refreshToken && !account?.accessToken) return null;
  return (await fresh(account))?.accessToken ?? null;
}

async function credentialsFor(accountId) {
  const account = store.findAccount(accountId);
  if (!account) return null;
  return asResponse(await fresh(account));
}

async function tokenForHost(hostId, params) {
  const account = selectAccount(store.read(), hostId, params);
  if (!account) return null;
  return asResponse(await fresh(account));
}

module.exports = { tokenForHost, refreshAccount, accessTokenFor, credentialsFor };
