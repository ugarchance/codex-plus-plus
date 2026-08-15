const { ipcMain } = require("electron");

console.log("==> codexpp hub başlatıldı");

ipcMain.handle("codexpp:auth-refresh", async () => {
  return null;
});
