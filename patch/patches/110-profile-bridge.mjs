export default {
  id: "110-profile-bridge",
  description: "Expose __cxpProfile IPC bridge in renderer preload",
  glob: ".vite/build/preload.js",
  marker: 'exposeInMainWorld("__cxpProfile"',
  apply(source) {
    const injection = [
      "",
      ";(() => {",
      '  const { contextBridge, ipcRenderer } = require("electron");',
      '  try {',
      '    contextBridge.exposeInMainWorld("__cxpProfile", {',
      '      getCombinedProfile: (force) => ipcRenderer.invoke("codexpp:combined-profile", force === true)',
      "    });",
      "  } catch (err) {",
      '    console.error("==> codexpp preload failed to expose __cxpProfile:", err.message);',
      "  }",
      "})();",
      ""
    ].join("\n");
    return source + injection;
  }
};
