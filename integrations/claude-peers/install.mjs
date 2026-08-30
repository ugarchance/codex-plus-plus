#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARKER = "[mcp_servers.claude_peers]";

function arg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const codexHome = path.resolve(arg("--codex-home", process.env.CODEX_HOME || path.join(os.homedir(), ".codex")));
const remove = process.argv.includes("--remove");
const configPath = path.join(codexHome, "config.toml");
const targetDir = path.join(codexHome, "mcp", "claude-peers");
const targetServer = path.join(targetDir, "server.mjs");

function readConfig() {
  try {
    return fs.readFileSync(configPath, "utf8");
  } catch {
    return "";
  }
}

function stripBlock(source) {
  const start = source.indexOf(MARKER);
  if (start === -1) return { source, found: false };
  const after = source.indexOf("\n[", start + MARKER.length);
  const end = after === -1 ? source.length : after + 1;
  const head = source.slice(0, start).replace(/\n+$/, "\n");
  return { source: head + source.slice(end), found: true };
}

function block(serverPath) {
  return [
    MARKER,
    'command = "node"',
    `args = [${JSON.stringify(serverPath)}]`,
    "startup_timeout_sec = 20",
    "",
  ].join("\n");
}

function backup() {
  if (!fs.existsSync(configPath)) return null;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const dest = `${configPath}.bak-claude-peers-${stamp}`;
  fs.copyFileSync(configPath, dest);
  return dest;
}

if (remove) {
  const { source, found } = stripBlock(readConfig());
  if (found) {
    backup();
    fs.writeFileSync(configPath, source);
    console.log("==> claude-peers unregistered from config.toml");
  } else {
    console.log("==> claude-peers was not registered, nothing to remove");
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  process.exit(0);
}

if (!fs.existsSync(configPath)) {
  console.log(`==> no ${configPath}, skipping claude-peers registration`);
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(path.join(HERE, "server.mjs"), targetServer);
fs.copyFileSync(path.join(HERE, "README.md"), path.join(targetDir, "README.md"));

const current = readConfig();
const desired = block(targetServer);
const { source: withoutBlock, found } = stripBlock(current);

if (found && current.includes(desired.trimEnd())) {
  console.log("==> claude-peers already registered, config unchanged");
  process.exit(0);
}

backup();
const separator = withoutBlock.endsWith("\n") || withoutBlock === "" ? "" : "\n";
fs.writeFileSync(configPath, `${withoutBlock}${separator}\n${desired}`);
console.log(found ? "==> claude-peers registration updated" : "==> claude-peers registered in config.toml");
console.log(`    server: ${targetServer}`);
