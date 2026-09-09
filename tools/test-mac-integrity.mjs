// macOS counterpart of test-windows-integrity.mjs: the Info.plist integrity plan
// runs everywhere; the plist/asar round trip needs plutil and PlistBuddy.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { planIntegrity, readIntegrity, updateMacIntegrity } from "../patch/mac-integrity.mjs";

const oldHash = "a".repeat(64), newHash = "b".repeat(64);
const entries = (hash) => ({ "Resources/app.asar": { algorithm: "SHA256", hash } });
assert.equal(planIntegrity(entries(oldHash), oldHash, newHash), "updated");
assert.equal(planIntegrity(entries(newHash), oldHash, newHash), "already current");
assert.equal(planIntegrity(null, oldHash, newHash), "not embedded");
assert.throws(() => planIntegrity(entries("c".repeat(64)), oldHash, newHash), /does not match/);
assert.throws(() => planIntegrity(entries(oldHash), oldHash, "invalid"), /Invalid target/);
assert.throws(() => planIntegrity({ ...entries(oldHash), "Resources/other.asar": entries(oldHash)["Resources/app.asar"] }, oldHash, newHash), /Unrecognized/);
assert.throws(() => planIntegrity({ "Resources/app.asar": { algorithm: "MD5", hash: oldHash } }, oldHash, newHash), /Unrecognized/);

if (process.platform !== "darwin") {
  console.log("macOS integrity: plan cases passed; plist round trip skipped on " + process.platform);
  process.exit(0);
}

const require = createRequire(new URL("../patch/package.json", import.meta.url));
const { createPackage, getRawHeader } = require("@electron/asar");
const crypto = await import("node:crypto");
const headerHash = (file) => crypto.createHash("sha256").update(getRawHeader(file).headerString).digest("hex");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "cxp-mac-integrity-"));
try {
  const source = path.join(work, "Source.app/Contents"), target = path.join(work, "Target.app/Contents");
  for (const [dir, body] of [[source, "original"], [target, "patched"]]) {
    fs.mkdirSync(path.join(dir, "Resources"), { recursive: true });
    fs.mkdirSync(path.join(work, body));
    fs.writeFileSync(path.join(work, body, "main.js"), `console.log(${JSON.stringify(body)})`);
    await createPackage(path.join(work, body), path.join(dir, "Resources/app.asar"));
  }
  const sourceAsar = path.join(source, "Resources/app.asar"), targetAsar = path.join(target, "Resources/app.asar");
  assert.notEqual(headerHash(sourceAsar), headerHash(targetAsar));
  const plist = path.join(target, "Info.plist");
  const writePlist = (json) => { fs.writeFileSync(plist, JSON.stringify(json)); execFileSync("plutil", ["-convert", "xml1", plist]); };

  writePlist({ CFBundleName: "Test", ElectronAsarIntegrity: entries(headerHash(sourceAsar)) });
  assert.equal(updateMacIntegrity(plist, sourceAsar, targetAsar), "updated");
  assert.equal(readIntegrity(plist)["Resources/app.asar"].hash, headerHash(targetAsar));
  assert.equal(readIntegrity(plist)["Resources/app.asar"].algorithm, "SHA256");
  assert.equal(execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleName", plist], { encoding: "utf8" }).trim(), "Test", "other keys untouched");
  assert.equal(updateMacIntegrity(plist, sourceAsar, targetAsar), "already current");

  writePlist({ CFBundleName: "Test" });
  assert.equal(updateMacIntegrity(plist, sourceAsar, targetAsar), "not embedded");
  assert.equal(readIntegrity(plist), null);

  writePlist({ ElectronAsarIntegrity: entries("c".repeat(64)) });
  assert.throws(() => updateMacIntegrity(plist, sourceAsar, targetAsar), /does not match/);
  assert.throws(() => updateMacIntegrity(plist, targetAsar, targetAsar), /separate writable/);
  assert.throws(() => updateMacIntegrity(path.join(source, "Info.plist"), sourceAsar, targetAsar), /ENOENT|separate writable|must belong/);
  console.log("macOS integrity: plan cases, plist round trip, idempotence, legacy and rejection cases passed");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
