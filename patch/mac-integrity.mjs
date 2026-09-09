import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { getRawHeader } from "@electron/asar";

// macOS counterpart of windows-integrity.mjs. Electron keeps the ASAR header
// hash in Info.plist (`ElectronAsarIntegrity`) instead of a PE resource; with
// the EnableEmbeddedAsarIntegrityValidation fuse on (Codex 26.901 / Electron
// 152) a copy whose header no longer matches aborts before bootstrap with
// "Failed to get integrity for validatable asar archive".
const KEY = "ElectronAsarIntegrity";
const ENTRY = "Resources/app.asar";
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";

export function readIntegrity(plistPath) {
  const json = execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], { encoding: "utf8" });
  return JSON.parse(json)[KEY] ?? null;
}

export function writeIntegrityHash(plistPath, hash) {
  execFileSync(PLIST_BUDDY, ["-c", `Set :${KEY}:${ENTRY}:hash ${hash}`, plistPath], { stdio: ["ignore", "ignore", "pipe"] });
}

export function planIntegrity(entries, sourceHash, targetHash) {
  // Older releases did not enable embedded ASAR validation.
  if (entries == null) return "not embedded";
  const entry = entries[ENTRY];
  if (typeof entries !== "object" || Object.keys(entries).length !== 1 || !entry ||
      String(entry.algorithm).toUpperCase() !== "SHA256" || typeof entry.hash !== "string") {
    throw new Error("Unrecognized Electron ASAR integrity metadata");
  }
  if (entry.hash === targetHash) return "already current";
  if (entry.hash !== sourceHash) throw new Error("Info.plist integrity does not match source ASAR");
  if (!/^[a-f0-9]{64}$/.test(targetHash)) throw new Error("Invalid target SHA256");
  return "updated";
}

export function updateMacIntegrity(plistPath, sourceAsar, targetAsar) {
  const plist = fs.realpathSync(plistPath);
  const source = fs.realpathSync(sourceAsar);
  const target = fs.realpathSync(targetAsar);
  const contents = path.dirname(plist);
  if (source === target || contents === path.dirname(path.dirname(source))) {
    throw new Error("Integrity updates require a separate writable application copy");
  }
  if (path.join(contents, "Resources", "app.asar") !== target) {
    throw new Error("Target ASAR must belong to the Info.plist bundle");
  }
  const digest = (file) => crypto.createHash("sha256").update(getRawHeader(file).headerString).digest("hex");
  const targetHash = digest(target);
  const status = planIntegrity(readIntegrity(plist), digest(source), targetHash);
  if (status === "updated") {
    writeIntegrityHash(plist, targetHash);
    if (readIntegrity(plist)?.[ENTRY]?.hash !== targetHash) throw new Error("Info.plist integrity write did not stick");
  }
  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [plist, source, target] = process.argv.slice(2);
  if (!plist || !source || !target) throw new Error("Usage: node patch/mac-integrity.mjs <copied Info.plist> <source asar> <patched asar>");
  console.log(`==> macOS ASAR integrity: ${updateMacIntegrity(plist, source, target)}`);
}
