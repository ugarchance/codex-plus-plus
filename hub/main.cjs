const { ipcMain } = require("electron");
const store = require("./store.cjs");
const tokens = require("./tokens.cjs");
const login = require("./login.cjs");
const usage = require("./usage.cjs");
const accounts = require("./accounts.cjs");
const profile = require("./profile.cjs");
const routing = require("./routing.cjs");
require("./provider-main.cjs");

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
  guard("failed to activate account", (_event, accountId, options) => accounts.activate(accountId, options && typeof options === "object" ? { transient: options.transient === true } : {}))
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

ipcMain.on("codexpp:routing-view", (event) => {
  try {
    const data = routing.read();
    event.returnValue = {
      version: data.version ?? 1,
      threadOwner: data.threadOwner ?? {},
      learnedIneligible: data.learnedIneligible ?? {},
      autoRoute: data.autoRoute !== false,
      activeAccountId: store.activeAccountId()
    };
  } catch (err) {
    console.error("==> codexpp routing-view error:", err.message);
    event.returnValue = { version: 1, threadOwner: {}, learnedIneligible: {}, autoRoute: true, activeAccountId: null };
  }
});

ipcMain.handle("codexpp:routing-set-auto", (_event, enabled) => {
  return routing.setAutoRoute(enabled);
});

ipcMain.handle("codexpp:routing-learn-owner", (_event, threadId, accountId) => {
  return routing.learnThreadOwner(threadId, accountId);
});

ipcMain.handle("codexpp:routing-forget-owner", (_event, threadId) => {
  return routing.forgetThreadOwner(threadId);
});

ipcMain.handle("codexpp:routing-suggest", async (_event, excluded) => {
  try {
    const list = store.accounts();
    const learned = routing.read().learnedIneligible;
    return routing.chooseAccount(list, excluded, learned);
  } catch (err) {
    console.error("==> codexpp routing-suggest error:", err.message);
    return null;
  }
});

ipcMain.handle("codexpp:routing-mark-ineligible", (_event, accountId, reason) => {
  return routing.markIneligible(accountId, reason);
});

ipcMain.handle("codexpp:routing-clear-ineligible", (_event, accountId) => {
  return routing.clearIneligible(accountId);
});

store.setActive(null);
usage.refreshAll({ force: true }).catch(() => {});

console.log("==> codexpp hub started");

ipcMain.handle("codexpp:add-account-device-code", async (_event, label, timeoutMs) => {
  try {
    await login.addAccountDeviceCode(label, timeoutMs);
    await usage.refreshAll({ force: true });
    return { ok: true, view: store.publicView() };
  } catch (err) {
    console.error("==> codexpp could not add account (device code):", err.message);
    return { ok: false, error: err.message };
  }
});

const resets = require("./resets.cjs");

ipcMain.handle("codexpp:reset-credits", async (_event, accountId, force) => {
  try {
    const data = await resets.creditsFor(accountId, { force: force === true });
    return { ok: true, data };
  } catch (err) {
    console.error("==> codexpp reset-credits failed:", err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("codexpp:consume-reset", async (_event, accountId, creditId, redeemRequestId) => {
  try {
    const data = await resets.consumeCredit(accountId, creditId, redeemRequestId);
    return { ok: true, data };
  } catch (err) {
    console.error("==> codexpp consume-reset failed:", err.message);
    return { ok: false, error: err.message };
  }
});


const gateway = require("./gateway.cjs");

gateway.start()
  .then(({ baseUrl }) => console.log(`==> codexpp gateway on ${baseUrl}`))
  .catch((err) => console.error("==> codexpp gateway failed to start:", err.message));

const brokerSocket = require("./broker-socket.cjs");
const tunnel = require("./tunnel.cjs");

brokerSocket.start()
  .then(async ({ socketPath }) => {
    console.log(`==> codexpp broker socket on ${socketPath}`);
    const started = await tunnel.start(socketPath);
    console.log(started.running
      ? `==> codexpp tunnel running ${started.tunnelId ?? ""}`.trim()
      : `==> codexpp tunnel not started: ${started.reason}`);
  })
  .catch((err) => console.error("==> codexpp broker socket failed to start:", err.message));

require("electron").app.on("will-quit", () => tunnel.stop());

ipcMain.on("codexpp:gateway-route", (event) => {
  event.returnValue = gateway.route();
});

const webSession = require("./web-session.cjs");

ipcMain.handle("codexpp:web-open", guard("failed to open the ChatGPT window", async (_event, options) => {
  webSession.open(options ?? {});
  return { ok: true };
}));

ipcMain.handle("codexpp:web-status", guard("failed to read the ChatGPT window", () => webSession.status()));

ipcMain.handle("codexpp:web-close", guard("failed to close the ChatGPT window", () => {
  webSession.close();
  return { ok: true };
}));

ipcMain.handle("codexpp:web-effort", guard("failed to read the ChatGPT effort control", () =>
  webSession.effortTrigger()));
