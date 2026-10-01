import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { enableLongPaths } from "../patch/windows-long-paths.mjs";
const require = createRequire(new URL("../patch/package.json", import.meta.url));
const { NtExecutable, NtExecutableResource } = require("resedit");
const xml = '<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><trustInfo xmlns="urn:schemas-microsoft-com:asm.v2"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo></assembly>';
function fixture(manifest = xml, count = 1) {
  const exe = NtExecutable.createEmpty(false, false), resources = NtExecutableResource.from(exe);
  for (let id = 1; id <= count; id++) resources.entries.push({ type: 24, id, lang: 1033, codepage: 65001, bin: new TextEncoder().encode(manifest).buffer });
  resources.entries.push({ type: 10, id: 100, lang: 1033, codepage: 0, bin: new Uint8Array([1, 2, 3, 4]).buffer });
  resources.outputResource(exe);
  return Buffer.from(exe.generate());
}
const before = fixture(), result = enableLongPaths(before);
assert.equal(result.status, "enabled");
const entries = NtExecutableResource.from(NtExecutable.from(result.buffer)).entries;
const actual = Buffer.from(entries.find(entry => entry.type === 24).bin).toString();
assert(actual.includes('longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true'));
assert(actual.includes('level="asInvoker" uiAccess="false"'));
assert.deepEqual(Buffer.from(entries.find(entry => entry.type === 10).bin), Buffer.from([1, 2, 3, 4]));
assert.equal(enableLongPaths(result.buffer).status, "already enabled");
assert(enableLongPaths(result.buffer).buffer.equals(result.buffer));
assert.throws(() => enableLongPaths(fixture(xml, 0)), /one sandbox helper manifest/);
assert.throws(() => enableLongPaths(fixture(xml, 2)), /one sandbox helper manifest/);
assert.throws(() => enableLongPaths(fixture(xml.replace("asInvoker", "requireAdministrator"))), /non-elevated/);
assert.throws(() => enableLongPaths(fixture(xml.replace("</assembly>", "<application/></assembly>"))), /Unrecognized application/);
console.log("Windows long paths: manifest opt-in, retained privileges/resources, idempotence and rejection cases passed");
