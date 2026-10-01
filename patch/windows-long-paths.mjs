import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NtExecutable, NtExecutableResource } from "resedit";

// The sandbox helper validates runtime trees with CreateFileW. On 26.928 its
// manifest omits longPathAware, so >260-character paths fail even when Windows
// LongPathsEnabled is on. Opt in on the separate Codex++ copy only. This changes
// the PE resources (and removes the now-invalid vendor signature), never code,
// requested privileges, sandbox policy, credentials, or the Windows registry.
export function enableLongPaths(buffer) {
  const exe = NtExecutable.from(buffer, { ignoreCert: true });
  const resources = NtExecutableResource.from(exe);
  const manifests = resources.entries.filter(entry => entry.type === 24);
  assert.equal(manifests.length, 1, "Expected one sandbox helper manifest");
  const manifest = manifests[0];
  const xml = Buffer.from(manifest.bin).toString("utf8");
  if (/<(?:\w+:)?longPathAware\b[^>]*>\s*true\s*<\//.test(xml)) {
    return { buffer, status: "already enabled" };
  }
  assert(!xml.includes("longPathAware"), "Unrecognized long-path declaration");
  assert(!/<(?:\w+:)?application\b/.test(xml), "Unrecognized application manifest settings");
  assert.equal(xml.split("</assembly>").length, 2, "Expected one manifest root");
  assert(/requestedExecutionLevel\s+level="asInvoker"/.test(xml), "Expected non-elevated sandbox helper");
  const sections = exe.getAllSections().map(section => ({
    info: { ...section.info }, data: Buffer.from(section.data ?? []),
  }));
  const otherResources = resources.entries.filter(entry => entry !== manifest).map(entry => ({
    ...entry, bin: Buffer.from(entry.bin),
  }));
  const declaration = '<application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>' +
    '<longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>' +
    '</windowsSettings></application>';
  manifest.bin = Uint8Array.from(Buffer.from(xml.replace("</assembly>", declaration + "</assembly>"))).buffer;
  resources.outputResource(exe);
  const output = Buffer.from(exe.generate());
  const parsed = NtExecutable.from(output);
  for (const section of sections) {
    const current = parsed.getAllSections().find(item => item.info.name === section.info.name);
    assert(current, "Missing PE section");
    assert.equal(current.info.virtualAddress, section.info.virtualAddress, "Moved PE virtual address");
    if (section.info.name !== ".rsrc") {
      assert(Buffer.from(current.data ?? []).equals(section.data), "Changed non-resource PE section");
    }
  }
  const reparsed = NtExecutableResource.from(parsed).entries;
  assert.equal(reparsed.length, resources.entries.length, "Changed resource count");
  for (const entry of otherResources) {
    const current = reparsed.find(item => item.type === entry.type && item.id === entry.id && item.lang === entry.lang);
    assert(current && Buffer.from(current.bin).equals(entry.bin), "Changed unrelated PE resource");
  }
  const updated = reparsed.find(entry => entry.type === 24);
  assert.equal(Buffer.from(updated.bin).toString("utf8"), xml.replace("</assembly>", declaration + "</assembly>"));
  return { buffer: output, status: "enabled" };
}

export function patchSandboxHelper(targetPath, sourcePath) {
  const target = fs.realpathSync(targetPath), source = fs.realpathSync(sourcePath);
  if (target.toLowerCase() === source.toLowerCase() ||
      path.dirname(target).toLowerCase() === path.dirname(source).toLowerCase() ||
      target.toLowerCase().includes("\\windowsapps\\")) {
    throw new Error("Long-path update requires a separate writable application copy");
  }
  if (path.basename(target).toLowerCase() !== "codex-windows-sandbox-setup.exe" ||
      path.basename(source).toLowerCase() !== "codex-windows-sandbox-setup.exe") {
    throw new Error("Expected sandbox setup helper paths");
  }
  const result = enableLongPaths(fs.readFileSync(target));
  if (result.status === "enabled") fs.writeFileSync(target, result.buffer);
  return result.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error("Usage: node patch/windows-long-paths.mjs <copied helper> <original helper>");
  console.log(`Windows sandbox long paths: ${patchSandboxHelper(process.argv[2], process.argv[3])}`);
}
