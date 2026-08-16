const { ipcMain } = require("electron");
const store = require("./store.cjs");
const tokens = require("./tokens.cjs");
const login = require("./login.cjs");
const usage = require("./usage.cjs");
const accounts = require("./accounts.cjs");

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

