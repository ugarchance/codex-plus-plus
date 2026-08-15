const { ipcMain } = require("electron");
const store = require("./store.cjs");
const tokens = require("./tokens.cjs");

ipcMain.handle("codexpp:auth-refresh", async (_event, hostId, params) => {
  try {
    return await tokens.tokenForHost(hostId, params);
  } catch (err) {
    console.error("==> codexpp token yenileme hatasi:", err.message);
    return null;
  }
});

ipcMain.handle("codexpp:accounts", () => store.publicView());

ipcMain.handle("codexpp:assign", (_event, hostId, accountId) => {
  const data = store.read();
  if (accountId === null) delete data.assignments[hostId];
  else data.assignments[hostId] = accountId;
  store.write(data);
  return store.publicView();
});

console.log("==> codexpp hub başlatıldı");
