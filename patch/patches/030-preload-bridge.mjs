export default {
  id: "030-preload-bridge",
  description: "Expose __codexpp IPC bridge in renderer preload",
  glob: ".vite/build/preload.js",
  marker: 'exposeInMainWorld("__codexpp"',
  apply(source) {
    const injection = [
      "",
      ";(() => {",
      '  const { contextBridge, ipcRenderer } = require("electron");',
      '  contextBridge.exposeInMainWorld("__codexpp", {',
      '    authRefresh: (hostId, params) => ipcRenderer.invoke("codexpp:auth-refresh", hostId, params),',
      '    accountsSync: () => ipcRenderer.sendSync("codexpp:accounts-sync"),',
      '    refreshUsage: (force) => ipcRenderer.invoke("codexpp:refresh-usage", force),',
      '    activate: (accountId) => ipcRenderer.invoke("codexpp:activate", accountId),',
      '    logoutPlan: (accountId) => ipcRenderer.invoke("codexpp:logout-plan", accountId),',
      '    logoutCommit: (accountId, nextId) => ipcRenderer.invoke("codexpp:logout-commit", accountId, nextId),',
      '    addAccount: (label) => ipcRenderer.invoke("codexpp:add-account", label),',
      '    assign: (hostId, accountId) => ipcRenderer.invoke("codexpp:assign", hostId, accountId)',
      "  });",
      "})();",
      ""
    ].join("\n");
    return source + injection;
  }
};
