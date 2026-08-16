#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function printUsage() {
  console.log("Usage: node tools/add-account.mjs [options] <label>");
  console.log("");
  console.log("Options:");
  console.log("  --device-code       Use device-code authorization flow instead of browser popup");
  console.log("  --timeout <sec>     Timeout in seconds for device-code flow (default: 180)");
  console.log("  -h, --help          Show this help message");
  console.log("");
  console.log("Opens ChatGPT login and adds the session to the Codex++ store.");
  console.log("The label is how you tell accounts apart: \"Personal\", \"Work\".");
}

const args = process.argv.slice(2);
let isDeviceCode = false;
let timeoutSec = 180;
let label = null;
let showHelp = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    showHelp = true;
  } else if (arg === "--device-code") {
    isDeviceCode = true;
  } else if (arg === "--timeout") {
    i++;
    if (i >= args.length || isNaN(Number(args[i]))) {
      console.error("error: --timeout requires a numeric value in seconds");
      printUsage();
      process.exit(1);
    }
    timeoutSec = Number(args[i]);
  } else if (arg.startsWith("--timeout=")) {
    const val = arg.slice("--timeout=".length);
    if (!val || isNaN(Number(val))) {
      console.error("error: --timeout requires a numeric value in seconds");
      printUsage();
      process.exit(1);
    }
    timeoutSec = Number(val);
  } else if (arg.startsWith("-")) {
    console.error(`error: unknown option ${arg}`);
    printUsage();
    process.exit(1);
  } else {
    if (!label) {
      label = arg;
    } else {
      label = `${label} ${arg}`;
    }
  }
}

if (showHelp) {
  printUsage();
  process.exit(0);
}

if (!label) {
  printUsage();
  process.exit(1);
}

const store = require(path.join(repoDir, "hub/store.cjs"));
const login = require(path.join(repoDir, "hub/login.cjs"));

let added;
if (isDeviceCode) {
  console.log(`==> starting device-code login: ${label}`);
  try {
    added = await login.addAccountDeviceCode(label, {
      timeoutMs: timeoutSec * 1000,
      onPrompt: ({ userCode, verificationUrl }) => {
        console.log("");
        console.log("========================================");
        console.log(`  Device Code:       ${userCode}`);
        console.log(`  Verification URL:  ${verificationUrl}`);
        console.log("========================================");
        console.log("");
        console.log(`==> enter the code at ${verificationUrl}`);
        console.log(`==> waiting for authorization (timeout: ${timeoutSec}s)...`);
      }
    });
  } catch (err) {
    if (err.code === "ETIMEDOUT" || err.isTimeout || err.message.toLowerCase().includes("timed out")) {
      console.error(`error: device-code login timed out after ${timeoutSec}s`);
      process.exit(2);
    }
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
} else {
  console.log(`==> starting login: ${label}`);
  console.log("==> sign in with the account you want to add on the page that opens");
  try {
    added = await login.addAccount(label);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

console.log(`==> added: ${added.label}${added.email ? ` (${added.email})` : ""}${added.planType ? ` · ${added.planType}` : ""}${added.accountId ? ` · accountId: ${added.accountId}` : ""}`);
console.log(`==> ${store.read().accounts.length} account(s) total · ${store.storePath()}`);
