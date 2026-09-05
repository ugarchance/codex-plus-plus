import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getRawHeader } from "@electron/asar";
import { NtExecutable, NtExecutableResource } from "resedit";

export function updateIntegrity(executable, sourceHash, targetHash) {
  const exe = NtExecutable.from(executable, { ignoreCert: true });
  const resources = NtExecutableResource.from(exe).entries.filter(
    (entry) => String(entry.type).toUpperCase() === "INTEGRITY" &&
      String(entry.id).toUpperCase() === "ELECTRONASAR"
  );
  // Older releases did not enable embedded ASAR validation.
  if (resources.length === 0) return { buffer: executable, status: "not embedded" };
  if (resources.length !== 1) throw new Error("Expected one Electron ASAR integrity resource");
  const original = Buffer.from(resources[0].bin);
  const entries = JSON.parse(original.toString("utf8"));
  const matches = entries.filter((entry) => entry.file?.replaceAll("\\", "/") === "resources/app.asar");
  if (matches.length !== 1 || matches[0].alg?.toLowerCase() !== "sha256") {
    throw new Error("Unrecognized Electron ASAR integrity metadata");
  }
  const entry = matches[0];
  if (entry.value === targetHash) return { buffer: executable, status: "already current" };
  if (entry.value !== sourceHash) throw new Error("Executable integrity does not match source ASAR");
  // Replace only the validated fixed-size hash in the resource. Preserve PE
  // sections, overlays and all other resource bytes instead of rebuilding them.
  const hash = Buffer.from(sourceHash);
  const hashOffset = original.indexOf(hash);
  if (hashOffset < 0 || original.indexOf(hash, hashOffset + 1) !== -1) throw new Error("Ambiguous integrity hash");
  const offset = executable.indexOf(original);
  if (offset < 0 || executable.indexOf(original, offset + 1) !== -1) throw new Error("Ambiguous integrity resource bytes");
  if (!/^[a-f0-9]{64}$/.test(targetHash)) throw new Error("Invalid target SHA256");
  const buffer = Buffer.from(executable);
  buffer.write(targetHash, offset + hashOffset, "ascii");
  return { buffer, status: "updated" };
}

export function updateWindowsIntegrity(exePath, sourceAsar, targetAsar) {
  const exe = fs.realpathSync(exePath);
  const source = fs.realpathSync(sourceAsar);
  const target = fs.realpathSync(targetAsar);
  if (source === target || path.dirname(exe).toLowerCase() === path.dirname(path.dirname(source)).toLowerCase()) {
    throw new Error("Integrity updates require a separate writable application copy");
  }
  if (path.join(path.dirname(exe), "resources", "app.asar").toLowerCase() !== target.toLowerCase()) {
    throw new Error("Target ASAR must belong to the executable copy");
  }
  const digest = (file) => crypto.createHash("sha256").update(getRawHeader(file).headerString).digest("hex");
  const result = updateIntegrity(fs.readFileSync(exe), digest(source), digest(target));
  if (result.status === "updated") {
    const temp = `${exe}.integrity-${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, result.buffer, { flag: "wx" });
      fs.renameSync(temp, exe);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  return result.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [exe, source, target] = process.argv.slice(2);
  if (!exe || !source || !target) throw new Error("Usage: node patch/windows-integrity.mjs <copied exe> <source asar> <patched asar>");
  console.log(`==> Windows ASAR integrity: ${updateWindowsIntegrity(exe, source, target)}`);
}
