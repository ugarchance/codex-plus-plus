#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractAll, getRawHeader, createPackageFromStreams } from "@electron/asar";
import patches from "./patches/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function info(msg) {
  console.log(`==> ${msg}`);
}

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log("Usage: node patch/apply.mjs --src <source app.asar> [--out <target app.asar>] [--work <scratch dir>] [--check-only] [--allow-untested-source]");
      console.log("");
      console.log("Options:");
      console.log("  --src <file>              path to the source app.asar");
      console.log("  --out <file>              path to the target app.asar");
      console.log("  --work <dir>              optional scratch directory");
      console.log("  --check-only              check source compatibility and exit without patching");
      console.log("  --allow-untested-source   proceed even if source build is untested");
      console.log("  -h, --help                show this message");
      process.exit(0);
    } else if (arg === "--src") {
      if (i + 1 >= args.length) die("--src needs a value");
      options.src = args[++i];
    } else if (arg.startsWith("--src=")) {
      options.src = arg.slice(6);
    } else if (arg === "--out") {
      if (i + 1 >= args.length) die("--out needs a value");
      options.out = args[++i];
    } else if (arg.startsWith("--out=")) {
      options.out = arg.slice(6);
    } else if (arg === "--work") {
      if (i + 1 >= args.length) die("--work needs a value");
      options.work = args[++i];
    } else if (arg.startsWith("--work=")) {
      options.work = arg.slice(7);
    } else if (arg === "--check-only") {
      options.checkOnly = true;
    } else if (arg === "--allow-untested-source") {
      options.allowUntestedSource = true;
    } else {
      die(`unknown argument: ${arg}`);
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
  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(baseDir, fullPath).split(path.sep).join("/");
        if (regex.test(relPath)) {
          matches.push(relPath);
        }
      }
    }
  }
  if (fs.existsSync(baseDir)) {
    walk(baseDir);
  }
  return matches;
}

function collectSourceUnpackedSets(srcPath) {
  const raw = getRawHeader(srcPath);
  const header = JSON.parse(raw.headerString);
  const unpackedFiles = new Set();
  const unpackedDirs = new Set();

  function traverse(node, prefix = "") {
    if (node.files) {
      if (node.unpacked) {
        unpackedDirs.add(prefix);
      }
      for (const [name, child] of Object.entries(node.files)) {
        const p = prefix ? `${prefix}/${name}` : name;
        traverse(child, p);
      }
    } else {
      if (node.unpacked) {
        unpackedFiles.add(prefix);
      }
    }
  }

  traverse(header);
  return { unpackedFiles, unpackedDirs };
}

function buildStreams(baseDir, unpackedFiles, unpackedDirs) {
  const streams = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(baseDir, fullPath).split(path.sep).join("/");

      if (entry.isDirectory()) {
        streams.push({
          path: relPath,
          type: "directory",
          unpacked: unpackedDirs.has(relPath),
        });
        walk(fullPath);
      } else if (entry.isSymbolicLink()) {
        const stat = fs.lstatSync(fullPath);
        streams.push({
          path: relPath,
          type: "link",
          unpacked: unpackedFiles.has(relPath),
          symlink: fs.readlinkSync(fullPath),
          stat,
          streamGenerator: () => fs.createReadStream(fullPath),
        });
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        streams.push({
          path: relPath,
          type: "file",
          unpacked: unpackedFiles.has(relPath),
          stat,
          streamGenerator: () => fs.createReadStream(fullPath),
        });
      }
    }
  }

  walk(baseDir);
  return streams;
}

function computeSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function verifyCompatibility(srcPath, allowUntestedSource) {
  const compatPath = path.join(__dirname, "compatibility.json");
  if (!fs.existsSync(compatPath)) {
    die(`compatibility manifest not found: ${compatPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(compatPath, "utf-8"));
  } catch (err) {
    die(`failed to parse compatibility manifest: ${err.message}`);
  }

  const actualSha256 = computeSha256(srcPath);
  const matched = (manifest.testedBuilds || []).find(
    (b) => b.asarSha256 && b.asarSha256.toLowerCase() === actualSha256.toLowerCase()
  );

  if (matched) {
    info(`source build verified: ${matched.version} (${matched.build}) on ${matched.platform}`);
    info(`asar sha256: ${actualSha256}`);
    return { ok: true, matched, actualSha256 };
  }

  if (allowUntestedSource) {
    info(`warning: untested source build (sha256: ${actualSha256}); proceeding because --allow-untested-source is set`);
    return { ok: true, matched: null, actualSha256 };
  }

  die(`untested source asar (sha256: ${actualSha256}). Pass --allow-untested-source to proceed.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.checkOnly) {
    if (!options.src) {
      die("--check-only requires --src <source app.asar>");
    }
    const srcPath = path.resolve(options.src);
    if (!fs.existsSync(srcPath)) {
      die(`source asar not found: ${srcPath}`);
    }
    verifyCompatibility(srcPath, options.allowUntestedSource);
    info("check complete: source is compatible");
    return;
  }

  if (!options.src || !options.out) {
    die("usage: node patch/apply.mjs --src <source app.asar> --out <target app.asar> [--work <scratch dir>] [--check-only] [--allow-untested-source]");
  }

  const srcPath = path.resolve(options.src);
  const outPath = path.resolve(options.out);

  if (!fs.existsSync(srcPath)) {
    die(`source asar not found: ${srcPath}`);
  }

  verifyCompatibility(srcPath, options.allowUntestedSource);

  const isCustomWorkDir = Boolean(options.work);
  const workDir = isCustomWorkDir
    ? path.resolve(options.work)
    : fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-patch-"));

  if (isCustomWorkDir && fs.existsSync(workDir)) {
    const entries = fs.readdirSync(workDir);
    if (entries.length > 0) {
      die(`work directory is not empty: ${workDir}`);
    }
  }

  let tempOut = null;

  try {
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }

    const { unpackedFiles, unpackedDirs } = collectSourceUnpackedSets(srcPath);

    info(`extracting source asar -> ${workDir}`);
    extractAll(srcPath, workDir);

    for (const patch of patches) {
      let matches = findFiles(workDir, patch.glob);
      if (patch.select) {
        matches = matches.filter((rel) =>
          fs.readFileSync(path.join(workDir, rel), "utf-8").includes(patch.select)
        );
      }
      if (matches.length !== 1) {
        const how = patch.select ? `${patch.glob} + "${patch.select}"` : patch.glob;
        throw new Error(`patch ${patch.id}: glob (${how}) had to match exactly one file, matched ${matches.length}`);
      }

      const relFile = matches[0];
      const targetFile = path.join(workDir, relFile);
      const source = fs.readFileSync(targetFile, "utf-8");

      if (patch.marker && source.includes(patch.marker)) {
        info(`already applied: ${patch.id} (${relFile})`);
        continue;
      }

      info(`applying: ${patch.id} (${relFile})`);
      const patched = patch.apply(source);
      fs.writeFileSync(targetFile, patched, "utf-8");
    }

    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    tempOut = path.join(outDir, `.tmp-${path.basename(outPath)}-${Date.now()}`);
    info(`packing -> ${outPath}`);

    const streams = buildStreams(workDir, unpackedFiles, unpackedDirs);
    await createPackageFromStreams(tempOut, streams);

    const srcUnpacked = `${srcPath}.unpacked`;
    const tempOutUnpacked = `${tempOut}.unpacked`;
    const outUnpacked = `${outPath}.unpacked`;

    if (fs.existsSync(srcUnpacked)) {
      if (!fs.existsSync(tempOutUnpacked)) {
        fs.mkdirSync(tempOutUnpacked, { recursive: true });
      }
      fs.cpSync(srcUnpacked, tempOutUnpacked, {
        recursive: true,
        force: false,
        errorOnExist: false,
        verbatimSymlinks: true,
      });
    }

    if (fs.existsSync(outUnpacked)) {
      fs.rmSync(outUnpacked, { recursive: true, force: true });
    }
    if (fs.existsSync(tempOutUnpacked)) {
      fs.renameSync(tempOutUnpacked, outUnpacked);
    }

    fs.renameSync(tempOut, outPath);

    tempOut = null;
  } catch (err) {
    if (tempOut && fs.existsSync(tempOut)) {
      fs.rmSync(tempOut, { force: true });
    }
    if (tempOut && fs.existsSync(`${tempOut}.unpacked`)) {
      fs.rmSync(`${tempOut}.unpacked`, { recursive: true, force: true });
    }
    if (!isCustomWorkDir && fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    die(err.message || String(err));
  }

  if (!isCustomWorkDir && fs.existsSync(workDir)) {
    info("cleaning up scratch directory");
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  info("done");
}

main();
