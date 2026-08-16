#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const label = process.argv[2];
if (!label || label === "--help" || label === "-h") {
  console.log("Usage: node tools/add-account.mjs <label>");
  console.log("");
  console.log("Opens the ChatGPT login in a browser and adds the session to the Codex++ store.");
  console.log("The label is how you tell accounts apart: \"Personal\", \"Work\".");
  process.exit(label ? 0 : 1);
}

const store = require(path.join(repoDir, "hub/store.cjs"));
const login = require(path.join(repoDir, "hub/login.cjs"));

console.log(`==> starting login: ${label}`);
console.log("==> sign in with the account you want to add on the page that opens");

let added;
try {
  added = await login.addAccount(label);
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}

console.log(`==> added: ${added.label}${added.email ? ` (${added.email})` : ""}${added.planType ? ` · ${added.planType}` : ""}`);
console.log(`==> ${store.read().accounts.length} account(s) total · ${store.storePath()}`);
