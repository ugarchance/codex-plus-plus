const { ipcMain } = require("electron");
const store = require("./store.cjs");
const tokens = require("./tokens.cjs");
const login = require("./login.cjs");
const usage = require("./usage.cjs");
const accounts = require("./accounts.cjs");
const profile = require("./profile.cjs");

function guard(label, handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error(`==> codexpp ${label}:`, err.message);
      return { ok: false, error: err.message };
    }
  };
}

ipcMain.handle("codexpp:auth-refresh", async (_event, hostId, params) => {
  try {
    return await tokens.tokenForHost(hostId, params);
  } catch (err) {
    console.error("==> codexpp token refresh failed:", err.message);
    return null;
  }
});

ipcMain.on("codexpp:accounts-sync", (event) => {
  event.returnValue = store.publicView();
});

ipcMain.handle("codexpp:refresh-usage", async (_event, force) => {
  try {
    return await usage.refreshAll({ force: force === true });
  } catch (err) {
    console.error("==> codexpp usage refresh failed:", err.message);
    return store.publicView();
  }
});

ipcMain.handle(
  "codexpp:activate",
  guard("failed to activate account", (_event, accountId) => accounts.activate(accountId))
);

ipcMain.handle(
  "codexpp:logout-plan",
  guard("failed to plan sign-out", (_event, accountId) => accounts.logoutPlan(accountId))
);

ipcMain.handle("codexpp:logout-commit", (_event, accountId, nextId) =>
  accounts.logoutCommit(accountId, nextId ?? null)
);

ipcMain.handle("codexpp:assign", (_event, hostId, accountId) => {
  const data = store.read();
  if (accountId === null) delete data.assignments[hostId];
  else data.assignments[hostId] = accountId;
  store.write(data);
  return store.publicView();
});

ipcMain.handle("codexpp:add-account", async (_event, label) => {
  try {
    await login.addAccount(label);
    await usage.refreshAll({ force: true });
    return { ok: true, view: store.publicView() };
  } catch (err) {
    console.error("==> codexpp could not add account:", err.message);
    return { ok: false, error: err.message };
  }
});

const PROFILE_ENDPOINT = "https://chatgpt.com/backend-api/wham/profiles/me";
const PROFILE_STALE_MS = 60_000;
let cachedProfile = null;
let profileCacheAt = 0;

async function fetchCombinedProfile(force = false) {
  if (!force && cachedProfile && Date.now() - profileCacheAt < PROFILE_STALE_MS) {
    return cachedProfile;
  }

  const accountList = store.accounts();
  if (accountList.length === 0) {
    return { partial: true, accounts: store.publicView().accounts };
  }

  const collected = [];
  let hasFailed = false;

  for (const acc of accountList) {
    try {
      const accessToken = await tokens.accessTokenFor(acc);
      if (!accessToken || !acc.accountId) {
        hasFailed = true;
        continue;
      }

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "ChatGPT-Account-ID": acc.accountId,
        "User-Agent": "Codex Subscription Router",
        Accept: "application/json"
      };

      const res = await fetch(PROFILE_ENDPOINT, { method: "GET", headers });
      if (!res.ok) {
        hasFailed = true;
        continue;
      }

      const data = await res.json();
      if (data && data.profile && data.stats) {
        collected.push(data);
      } else {
        hasFailed = true;
      }
    } catch (err) {
      console.error(`==> codexpp profile fetch failed for ${acc.id}:`, err.message);
      hasFailed = true;
    }
  }

  if (collected.length === 0) {
    return { partial: true, accounts: store.publicView().accounts };
  }

  const merged = profile.mergeProfiles(collected, { partial: hasFailed });
  cachedProfile = merged;
  profileCacheAt = Date.now();
  return merged;
}

ipcMain.handle("codexpp:combined-profile", async (_event, force) => {
  try {
    return await fetchCombinedProfile(force === true);
  } catch (err) {
    console.error("==> codexpp combined profile failed:", err.message);
    return { partial: true, accounts: store.publicView().accounts };
  }
});

store.setActive(null);
usage.refreshAll({ force: true }).catch(() => {});

console.log("==> codexpp hub started");

