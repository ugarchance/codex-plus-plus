export default {
  id: "020-hub-bootstrap",
  description: "Bootstrap codexpp hub in Electron main process",
  glob: ".vite/build/early-bootstrap.js",
  marker: '_path.join(process.resourcesPath,"hub","main.cjs")',
  apply(source) {
    const injection = 'try{const _path=require("node:path");require(_path.join(process.resourcesPath,"hub","main.cjs"))}catch(e){console.error("codexpp hub yuklenemedi:",e)};';
    return injection + source;
  }
};
