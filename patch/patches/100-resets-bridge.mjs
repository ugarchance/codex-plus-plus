import { matchOnce } from "../lib/anchor.mjs";

export default {
  id: "100-resets-bridge",
  description: "Expose __cxpResets IPC bridge in renderer preload",
  glob: ".vite/build/preload.js",
  marker: 'exposeInMainWorld("__cxpResets"',
  apply(source) {
    matchOnce(source, "exposeInMainWorld\\(`electronBridge`", "electronBridge exposure in preload");
    const injection = [
      "",
      ";(() => {",
      '  const { contextBridge, ipcRenderer } = require("electron");',
      '  contextBridge.exposeInMainWorld("__cxpResets", {',
      '    credits: (accountId, force) => ipcRenderer.invoke("codexpp:reset-credits", accountId, force),',
      '    consume: (accountId, creditId, redeemRequestId) => ipcRenderer.invoke("codexpp:consume-reset", accountId, creditId, redeemRequestId)',
      "  });",
      "})();",
      ""
    ].join("\n");
    return source + injection;
  }
};
