// macOS provider-secrets round trip through the real keychain helper.
// Uses a throwaway service name so the app's own master key is never touched.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

if (process.platform !== "darwin") {
  console.log("macOS keychain: skipped on " + process.platform);
  process.exit(0);
}

const repo = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "cxp-keychain-"));
const helper = path.join(work, "codexpp-keychain");
execFileSync("clang", ["-O2", "-Wall", "-Wextra", "-framework", "Security", "-framework", "CoreFoundation",
  "-o", helper, path.join(repo, "install/mac/keychain.c")], { stdio: "inherit" });
execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", helper], { stdio: "ignore" });

const service = `CodexPP Safe Storage (test ${process.pid})`;
process.env.CODEXPP_KEYCHAIN_HELPER = helper;
process.env.CODEXPP_KEYCHAIN_SERVICE = service;
const secrets = createRequire(import.meta.url)("../hub/provider-secrets.cjs");
const run = (cmd, input) => { try { execFileSync(helper, [cmd, "--service", service], { input, stdio: ["pipe", "pipe", "pipe"] }); return 0; } catch (e) { return e.status; } };

try {
  assert.equal(run("get"), 44, "no item before first use");
  assert.equal(secrets.getSelectedStorageBackend(), "macos-keychain");
  assert.equal(secrets.isEncryptionAvailable(), true, "first use creates the master key");
  assert.equal(run("get"), 0, "master key stored");
  assert.equal(run("set", "second"), 45, "add-only: an existing master key is never replaced");

  const plain = "sk-test-" + "x".repeat(200) + "-ünïcödé";
  const a = secrets.encryptString(plain), b = secrets.encryptString(plain);
  assert.equal(a.subarray(0, 12).toString(), "CXP-MACKC-1:");
  assert.equal(a.includes(Buffer.from("sk-test-")), false, "ciphertext hides the plaintext");
  assert.notEqual(a.toString("base64"), b.toString("base64"), "fresh IV per encryption");
  assert.equal(secrets.decryptString(a), plain);
  assert.equal(secrets.decryptString(b), plain);

  const tampered = Buffer.from(a); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => secrets.decryptString(tampered), /no longer matches/);
  assert.throws(() => secrets.decryptString(Buffer.from("CXP-DPAPI-1:abc")), /unsupported/);

  // A fresh process must read the same master key back from the keychain.
  secrets.resetForTests();
  assert.equal(secrets.decryptString(a), plain, "master key survives the in-memory cache reset");
  console.log("macOS keychain: helper build, add-only master key, AES-GCM round trip, tamper and format rejection passed");
} finally {
  run("delete");
  fs.rmSync(work, { recursive: true, force: true });
}
