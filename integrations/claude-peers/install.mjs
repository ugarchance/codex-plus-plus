#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
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
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return "";
  }
}

function stripBlock(source, removeChildren = true) {
  // Locate table boundaries without reserializing unrelated TOML. Strings and
  // comments cannot introduce headers; nested environment tables survive updates.
  const key = String.raw`(?:[\w-]+|"(?:[^"\\]|\\.)*"|'[^']*')`;
  const header = new RegExp(String.raw`^\s*(\[\[?)(${key}(?:\s*\.\s*${key})*)(\]\]?)\s*(?:#.*)?$`);
  const headers = [];
  let quote = null, offset = 0;
  for (const line of source.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const match = quote === null ? header.exec(line.trimEnd()) : null;
    if (match && match[1].length === match[3].length) {
      const keys = match[2].match(new RegExp(key, "g")).map(part =>
        part.startsWith('"') ? JSON.parse(part) : part.startsWith("'") ? part.slice(1, -1) : part);
      const owned = keys[0] === "mcp_servers" && keys[1] === "claude_peers" &&
        (removeChildren || keys.length === 2);
      headers.push({ offset, owned });
    }
    for (let i = 0; i < line.length; i++) {
      if (quote) {
        if (quote.startsWith('"') && line[i] === "\\") { i++; continue; }
        if (line.startsWith(quote, i)) { i += quote.length - 1; quote = null; }
      } else {
        if (line[i] === "#") break;
        if (line[i] === '"' || line[i] === "'") {
          quote = line.startsWith(line[i].repeat(3), i) ? line[i].repeat(3) : line[i];
          i += quote.length - 1;
        }
      }
    }
    offset += line.length;
  }
  if (quote) throw new Error("Unterminated TOML string; config.toml was not changed");
  let result = "", cursor = 0, found = false;
  for (let i = 0; i < headers.length; i++) {
    if (!headers[i].owned) continue;
    result += source.slice(cursor, headers[i].offset);
    cursor = headers[i + 1]?.offset ?? source.length;
    found = true;
  }
  return { source: result + source.slice(cursor), found };
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
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${configPath}.bak-claude-peers-${stamp}-${randomUUID()}`;
  fs.copyFileSync(configPath, dest, fs.constants.COPYFILE_EXCL);
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
const { source: withoutBlock, found } = stripBlock(current, false);

if (found && current.includes(desired.trimEnd())) {
  console.log("==> claude-peers already registered, config unchanged");
  process.exit(0);
}

backup();
const separator = withoutBlock.endsWith("\n") || withoutBlock === "" ? "" : "\n";
fs.writeFileSync(configPath, `${withoutBlock}${separator}\n${desired}`);
console.log(found ? "==> claude-peers registration updated" : "==> claude-peers registered in config.toml");
console.log(`    server: ${targetServer}`);
