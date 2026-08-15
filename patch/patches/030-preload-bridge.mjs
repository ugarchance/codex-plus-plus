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
      '    accounts: () => ipcRenderer.invoke("codexpp:accounts"),',
      '    assign: (hostId, accountId) => ipcRenderer.invoke("codexpp:assign", hostId, accountId)',
      "  });",
      "})();",
      ""
    ].join("\n");
    return source + injection;
  }
};
