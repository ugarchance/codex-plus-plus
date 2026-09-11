export default {
  id: "020-hub-bootstrap",
  description: "Bootstrap codexpp hub and disable the in-app updater in the Electron main process",
  glob: ".vite/build/early-bootstrap.js",
  marker: '_path.join(process.resourcesPath,"hub","main.cjs")',
  apply(source) {
    const injection =
      "process.env.CODEX_SPARKLE_ENABLED=`false`;" +
      'require(require("node:path").join(process.resourcesPath,"hub","home.cjs")).activate();' +
      'try{const _path=require("node:path");require(_path.join(process.resourcesPath,"hub","main.cjs"))}catch(e){console.error("failed to load codexpp hub:",e)};';
    return injection + source;
  }
};
