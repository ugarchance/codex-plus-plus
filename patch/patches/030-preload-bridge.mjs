export default {
  id: "030-preload-bridge",
  description: "Expose __codexpp IPC bridge in renderer preload",
  glob: ".vite/build/preload.js",
  marker: 'exposeInMainWorld("__codexpp"',
  apply(source) {
    const injection = '\n;(() => { const { contextBridge, ipcRenderer } = require("electron"); contextBridge.exposeInMainWorld("__codexpp", { authRefresh: async (hostId, params) => ipcRenderer.invoke("codexpp:auth-refresh", hostId, params) }); })();\n';
    return source + injection;
  }
};
