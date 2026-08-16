#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const patchRequire = createRequire(path.join(repoDir, "patch/apply.mjs"));
const { extractAll } = patchRequire("@electron/asar");

import patch100 from "../patch/patches/100-resets-bridge.mjs";
import patch101 from "../patch/patches/101-usage-modal.mjs";

async function runTest() {
  console.log("=== T4: Patch Fonksiyon Testi ===");
  const asarPath = "/Applications/ChatGPT.app/Contents/Resources/app.asar";
  if (!fs.existsSync(asarPath)) {
    throw new Error(`Asar not found at ${asarPath}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cxp-test-patch-"));
  console.log(`Extracting ${asarPath} -> ${tmpDir}`);
  extractAll(asarPath, tmpDir);

  // 1. Test 100-resets-bridge
  console.log("\n--- Testing Patch 100-resets-bridge ---");
  const preloadPath = path.join(tmpDir, ".vite/build/preload.js");
  const preloadSource = fs.readFileSync(preloadPath, "utf-8");
  console.log(`Read preload.js: ${preloadSource.length} bytes`);

  const preloadPatched = patch100.apply(preloadSource);
  console.log(`Applied patch 100: patched length = ${preloadPatched.length} bytes (diff: +${preloadPatched.length - preloadSource.length})`);

  if (!preloadPatched.includes(patch100.marker)) {
    throw new Error(`Marker "${patch100.marker}" missing in patched preload.js!`);
  }
  console.log(`-> Marker verified: "${patch100.marker}" is present in output.`);

  // 2. Test 101-usage-modal
  console.log("\n--- Testing Patch 101-usage-modal ---");
  const assetsDir = path.join(tmpDir, "webview/assets");
  const appInitialFile = fs.readdirSync(assetsDir).find(f => f.startsWith("app-initial-") && f.endsWith(".js"));
  if (!appInitialFile) {
    throw new Error("app-initial-*.js not found in extracted asar!");
  }
  const appInitialPath = path.join(assetsDir, appInitialFile);
  const appInitialSource = fs.readFileSync(appInitialPath, "utf-8");
  console.log(`Read ${appInitialFile}: ${appInitialSource.length} bytes`);

  const appInitialPatched = patch101.apply(appInitialSource);
  console.log(`Applied patch 101: patched length = ${appInitialPatched.length} bytes (diff: +${appInitialPatched.length - appInitialSource.length})`);

  if (!appInitialPatched.includes(patch101.marker)) {
    throw new Error(`Marker "${patch101.marker}" missing in patched ${appInitialFile}!`);
  }
  console.log(`-> Marker verified: "${patch101.marker}" is present in output.`);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`Cleaned up temp directory ${tmpDir}`);
  console.log("\nAll T4 patch tests passed without errors!");
}

runTest().catch((err) => {
  console.error("Patch test error:", err);
  process.exit(1);
});
