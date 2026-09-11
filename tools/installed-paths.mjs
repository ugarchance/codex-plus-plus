import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function requireExisting(label, candidate) {
  const resolved = path.resolve(candidate);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${label} not found: ${resolved}. Set ${label === "Codex engine" ? "CODEX_BIN" : "CODEXPP_ASAR"} explicitly.`);
  }
  return resolved;
}

export function resolveInstalledCodexBinary(override = process.env.CODEX_BIN) {
  const candidate = override || (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "CodexPP", "resources", "codex.exe")
    : process.platform === "darwin"
      ? "/Applications/CodexPP.app/Contents/Resources/codex"
      : "codex");
  return requireExisting("Codex engine", candidate);
}

export function resolveInstalledAsar(override = process.env.CODEXPP_ASAR) {
  if (override) return requireExisting("Codex++ app.asar", override);
  if (process.env.CODEX_BIN) {
    return requireExisting("Codex++ app.asar", path.join(path.dirname(process.env.CODEX_BIN), "app.asar"));
  }
  const candidate = process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "CodexPP", "resources", "app.asar")
    : process.platform === "darwin"
      ? "/Applications/CodexPP.app/Contents/Resources/app.asar"
      : "app.asar";
  return requireExisting("Codex++ app.asar", candidate);
}
