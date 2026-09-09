// Patch 096: on macOS the peer authorizer factory returns the permissive authorizer and logs why; other platforms untouched.
import assert from "node:assert/strict";
import vm from "node:vm";
import patch from "../patch/patches/096-native-pipe-peers.mjs";

const fixture =
  "var wf=()=>logger;function Tf(){if(process.platform!==`darwin`)return()=>({authorized:!0});let e=a.a.readFromPackageMetadata(),t=e!=null;" +
  "return wf().info(`browser-use native pipe peer authorization enabled`,{safe:{mode:`packaged`},sensitive:{}}),e=>({authorized:!1,reason:`missing-code-signing-identity`})}globalThis.Tf=Tf;";
const patched = patch.apply(fixture);
assert.throws(() => patch.apply(fixture + fixture.replaceAll("Tf", "Tg")), /exactly once/);
assert.match(patched, /codexpp-adhoc-bundle/);
for (const platform of ["darwin", "win32"]) {
  const logs = [];
  const context = { process: { platform }, logger: { info: (m, meta) => logs.push([m, meta?.safe?.reason ?? meta?.safe?.mode]) }, a: { a: { readFromPackageMetadata: () => ({ codexBuildFlavor: "prod" }) } } };
  context.globalThis = context;
  vm.runInNewContext(patched, context);
  const verdict = context.Tf()({ _handle: { fd: 3 } });
  if (platform === "darwin") {
    assert.deepEqual(JSON.parse(JSON.stringify(verdict)), { authorized: true });
    assert.deepEqual(JSON.parse(JSON.stringify(logs)), [["browser-use native pipe peer authorization disabled", "codexpp-adhoc-bundle"]]);
  } else {
    assert.equal(verdict.authorized, true, "non-darwin keeps the upstream early return");
    assert.equal(logs.length, 0);
  }
}
console.log("Native pipe peers: macOS authorizer bypass with log line, other platforms untouched, duplicate anchor rejected");
