import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { updateIntegrity } from "../patch/windows-integrity.mjs";
const require = createRequire(new URL("../patch/package.json", import.meta.url));
const { NtExecutable, NtExecutableResource } = require("resedit");
const oldHash = "a".repeat(64), newHash = "b".repeat(64);
function fixture(entries) {
  const exe = NtExecutable.createEmpty(false, false);
  const resource = NtExecutableResource.from(exe);
  if (entries) resource.entries.push({ type: "INTEGRITY", id: "ELECTRONASAR", lang: 1033, codepage: 1252,
    bin: new TextEncoder().encode(JSON.stringify(entries)).buffer });
  resource.outputResource(exe);
  return Buffer.from(exe.generate());
}
const source = fixture([{ file: "resources\\app.asar", alg: "SHA256", value: oldHash }]);
const result = updateIntegrity(source, oldHash, newHash);
assert.equal(result.status, "updated");
assert.equal(result.buffer.length, source.length);
assert.equal([...source].filter((byte, i) => byte !== result.buffer[i]).length, 64);
const resource = NtExecutableResource.from(NtExecutable.from(result.buffer));
assert.equal(JSON.parse(Buffer.from(resource.entries[0].bin).toString())[0].value, newHash);
assert.equal(updateIntegrity(result.buffer, oldHash, newHash).status, "already current");
assert.throws(() => updateIntegrity(source, "c".repeat(64), newHash), /does not match/);
assert.throws(() => updateIntegrity(source, oldHash, "invalid"), /Invalid target/);
assert.equal(updateIntegrity(fixture(), oldHash, newHash).status, "not embedded");
assert.throws(() => updateIntegrity(fixture([
  {file:"resources\\app.asar",alg:"SHA256",value:oldHash},
  {file:"resources\\app.asar",alg:"SHA256",value:oldHash}
]),oldHash,newHash), /Unrecognized/);
console.log("Windows integrity: resource round-trip, exact byte scope, idempotence, legacy and rejection cases passed");
