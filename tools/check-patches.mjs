#!/usr/bin/env node

// Applies every patch to an unpatched app.asar in isolation and reports which
// ones still match. Run this first after a Codex update: it names the broken
// patch instead of stopping at whichever one apply.mjs reaches first.
//
//   node tools/check-patches.mjs [--src <app.asar>] [--work <dir>] [--keep]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import patches from "../patch/patches/index.mjs";

const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(repoDir, "patch/apply.mjs"));
const { extractAll } = require("@electron/asar");

const DEFAULT_SRC = process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "CodexPP", "resources", "app.asar")
  : "/Applications/ChatGPT.app/Contents/Resources/app.asar";

function parseArgs(argv) {
  const options = { src: DEFAULT_SRC, keep: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--src") options.src = argv[++i];
    else if (argv[i] === "--work") options.work = argv[++i];
    else if (argv[i] === "--keep") options.keep = true;
    else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log("Usage: node tools/check-patches.mjs [--src <app.asar>] [--work <dir>] [--keep]");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return options;
}

function globToRegex(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

function findFiles(baseDir, pattern) {
  const regex = globToRegex(pattern);
  const matches = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = path.relative(baseDir, full).split(path.sep).join("/");
        if (regex.test(rel)) matches.push(rel);
      }
    }
  })(baseDir);
  return matches;
}

const options = parseArgs(process.argv.slice(2));
const srcPath = path.resolve(options.src);
if (!fs.existsSync(srcPath)) {
  console.error(`error: source asar not found: ${srcPath}`);
  process.exit(1);
}

const workDir = options.work
  ? path.resolve(options.work)
  : fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-check-"));

if (!fs.existsSync(path.join(workDir, ".vite"))) {
  fs.mkdirSync(workDir, { recursive: true });
  console.log(`==> extracting ${srcPath}`);
  extractAll(srcPath, workDir);
}

const results = [];
for (const patch of patches) {
  let matches = findFiles(workDir, patch.glob);
  if (patch.select) {
    matches = matches.filter((rel) =>
      fs.readFileSync(path.join(workDir, rel), "utf-8").includes(patch.select)
    );
  }
  if (matches.length !== 1) {
    const how = patch.select ? `${patch.glob} + "${patch.select}"` : patch.glob;
    results.push({ id: patch.id, status: "GLOB", detail: `${how} matched ${matches.length}` });
    continue;
  }

  const rel = matches[0];
  const source = fs.readFileSync(path.join(workDir, rel), "utf-8");
  if (patch.marker && source.includes(patch.marker)) {
    results.push({ id: patch.id, status: "APPLIED", detail: `${rel} (source is already patched)` });
    continue;
  }
  try {
    const patched = patch.apply(source);
    if (patch.marker && !patched.includes(patch.marker)) {
      results.push({ id: patch.id, status: "MARKER", detail: `${rel}: marker absent after apply` });
    } else {
      results.push({ id: patch.id, status: "OK", detail: `${rel} (+${patched.length - source.length} bytes)` });
    }
  } catch (err) {
    results.push({ id: patch.id, status: "BROKEN", detail: `${rel}: ${err.message}` });
  }
}

const width = Math.max(...results.map((r) => r.id.length));
console.log("");
for (const r of results) {
  console.log(`${r.status.padEnd(8)} ${r.id.padEnd(width)}  ${r.detail}`);
}

const broken = results.filter((r) => r.status !== "OK" && r.status !== "APPLIED");
console.log(`\n${results.length - broken.length}/${results.length} matched`);

if (!options.work && !options.keep) {
  fs.rmSync(workDir, { recursive: true, force: true });
} else {
  console.log(`work dir: ${workDir}`);
}

process.exit(broken.length === 0 ? 0 : 1);
