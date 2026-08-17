#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const store = require(path.join(repoDir, "hub/store.cjs"));
const tokens = require(path.join(repoDir, "hub/tokens.cjs"));

const ENDPOINT = "https://chatgpt.com/backend-api/wham/profiles/me";
const USER_AGENTS = [
  "Codex Subscription Router",
  "codex_cli_rs",
  "ChatGPT/1.0"
];

async function probeAccount(account) {
  const label = account.label ?? account.email ?? account.id;
  const accessToken = await tokens.accessTokenFor(account);
  if (!accessToken) {
    console.log(`[PROBE] Account: ${label} - No access token available`);
    return { account: label, success: false, reason: "no_token" };
  }

  const results = [];
  for (const ua of USER_AGENTS) {
    try {
      const headers = {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ua,
        "Accept": "application/json"
      };
      if (account.accountId) {
        headers["ChatGPT-Account-ID"] = account.accountId;
      }

      const res = await fetch(ENDPOINT, {
        method: "GET",
        headers
      });

      const contentType = res.headers.get("content-type") || "unknown";
      let topLevelKeys = null;
      let isJson = false;

      if (contentType.includes("application/json")) {
        try {
          const data = await res.json();
          isJson = true;
          if (data && typeof data === "object" && !Array.isArray(data)) {
            topLevelKeys = Object.keys(data);
          } else if (Array.isArray(data)) {
            topLevelKeys = `[Array length: ${data.length}]`;
          }
        } catch {
          // not valid json
        }
      } else {
        // Drain body to prevent resource leak
        await res.text().catch(() => {});
      }

      console.log(`[PROBE] Account: ${label} | UA: ${ua} | Status: ${res.status} | Content-Type: ${contentType} | JSON Keys: ${topLevelKeys ? JSON.stringify(topLevelKeys) : (isJson ? "none" : "N/A")}`);
      results.push({
        ua,
        status: res.status,
        contentType,
        topLevelKeys,
        ok: res.ok
      });
    } catch (err) {
      console.log(`[PROBE] Account: ${label} | UA: ${ua} | Error: ${err.message}`);
      results.push({
        ua,
        error: err.message,
        ok: false
      });
    }
  }
  return { account: label, results };
}

async function main() {
  const accountList = store.accounts();
  console.log(`==> Probing ${accountList.length} account(s) against ${ENDPOINT}`);

  let anyPassed = false;
  for (const account of accountList) {
    const res = await probeAccount(account);
    if (res.results?.some((r) => r.ok)) {
      anyPassed = true;
    }
  }

  console.log("");
  if (anyPassed) {
    console.log("==> PROBE RESULT: PASSED");
  } else {
    console.log("==> PROBE RESULT: BLOCKED");
  }
}

main().catch((err) => {
  console.error("Probe fatal error:", err);
  process.exit(1);
});
