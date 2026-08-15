const { ipcMain } = require("electron");
const store = require("./store.cjs");
const tokens = require("./tokens.cjs");
const login = require("./login.cjs");

ipcMain.handle("codexpp:auth-refresh", async (_event, hostId, params) => {
  try {
    return await tokens.tokenForHost(hostId, params);
  } catch (err) {
    console.error("==> codexpp token yenileme hatasi:", err.message);
    return null;
  }
});

ipcMain.on("codexpp:accounts-sync", (event) => {
  event.returnValue = store.publicView();
});

ipcMain.handle("codexpp:accounts", () => store.publicView());

ipcMain.handle("codexpp:set-default", (_event, accountId) => {
  const data = store.read();
  if (data.accounts.some((a) => a.id === accountId)) {
    data.defaultAccountId = accountId;
    store.write(data);
  }
  return store.publicView();
});

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
    return { ok: true, view: store.publicView() };
  } catch (err) {
    console.error("==> codexpp hesap eklenemedi:", err.message);
    return { ok: false, error: err.message };
  }
});

console.log("==> codexpp hub başlatıldı");
