#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractAll, getRawHeader, createPackageFromStreams } from "@electron/asar";
import patches from "./patches/index.mjs";

function info(msg) {
  console.log(`==> ${msg}`);
}

function die(msg) {
  console.error(`hata: ${msg}`);
  process.exit(1);
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log("Kullanım: node patch/apply.mjs --src <kaynak app.asar> --out <hedef app.asar> [--work <geçici dizin>]");
      console.log("");
      console.log("Seçenekler:");
      console.log("  --src <dosya>   Kaynak app.asar dosya yolu");
      console.log("  --out <dosya>   Hedef app.asar dosya yolu");
      console.log("  --work <dizin>  İsteğe bağlı geçici çalışma dizini");
      console.log("  -h, --help      Yardım mesajını gösterir");
      process.exit(0);
    } else if (arg === "--src") {
      if (i + 1 >= args.length) die("--src değeri eksik");
      options.src = args[++i];
    } else if (arg.startsWith("--src=")) {
      options.src = arg.slice(6);
    } else if (arg === "--out") {
      if (i + 1 >= args.length) die("--out değeri eksik");
      options.out = args[++i];
    } else if (arg.startsWith("--out=")) {
      options.out = arg.slice(6);
    } else if (arg === "--work") {
      if (i + 1 >= args.length) die("--work değeri eksik");
      options.work = args[++i];
    } else if (arg.startsWith("--work=")) {
      options.work = arg.slice(7);
    } else {
      die(`bilinmeyen argüman: ${arg}`);
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
        const relPath = path.relative(baseDir, fullPath);
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
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(baseDir, fullPath);

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

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.src || !options.out) {
    die("kullanım: node patch/apply.mjs --src <kaynak app.asar> --out <hedef app.asar> [--work <geçici dizin>]");
  }

  const srcPath = path.resolve(options.src);
  const outPath = path.resolve(options.out);

  if (!fs.existsSync(srcPath)) {
    die(`kaynak asar dosyası bulunamadı: ${srcPath}`);
  }

  const isCustomWorkDir = Boolean(options.work);
  const workDir = isCustomWorkDir
    ? path.resolve(options.work)
    : fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-patch-"));

  if (isCustomWorkDir && fs.existsSync(workDir)) {
    const entries = fs.readdirSync(workDir);
    if (entries.length > 0) {
      die(`çalışma dizini boş değil: ${workDir}`);
    }
  }

  let tempOut = null;

  try {
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }

    const { unpackedFiles, unpackedDirs } = collectSourceUnpackedSets(srcPath);

    info(`kaynak asar açılıyor -> ${workDir}`);
    extractAll(srcPath, workDir);

    for (const patch of patches) {
      const matches = findFiles(workDir, patch.glob);
      if (matches.length !== 1) {
        throw new Error(`yama ${patch.id} için glob (${patch.glob}) tam olarak 1 dosya ile eşleşmeliydi, ${matches.length} dosya bulundu`);
      }

      const relFile = matches[0];
      const targetFile = path.join(workDir, relFile);
      const source = fs.readFileSync(targetFile, "utf-8");

      if (patch.marker && source.includes(patch.marker)) {
        info(`yama zaten uygulanmış: ${patch.id} (${relFile})`);
        continue;
      }

      info(`yama uygulanıyor: ${patch.id} (${relFile})`);
      const patched = patch.apply(source);
      fs.writeFileSync(targetFile, patched, "utf-8");
    }

    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    tempOut = path.join(outDir, `.tmp-${path.basename(outPath)}-${Date.now()}`);
    info(`paketleniyor -> ${outPath}`);

    const streams = buildStreams(workDir, unpackedFiles, unpackedDirs);
    await createPackageFromStreams(tempOut, streams);

    fs.renameSync(tempOut, outPath);

    const tempOutUnpacked = `${tempOut}.unpacked`;
    const outUnpacked = `${outPath}.unpacked`;
    if (fs.existsSync(tempOutUnpacked)) {
      if (fs.existsSync(outUnpacked)) {
        fs.rmSync(outUnpacked, { recursive: true, force: true });
      }
      fs.renameSync(tempOutUnpacked, outUnpacked);
    }

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
    info("geçici dizin temizleniyor");
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  info("tamamlandı");
}

main();
