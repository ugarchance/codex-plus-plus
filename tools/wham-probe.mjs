#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const store = require(path.join(repoDir, "hub/store.cjs"));
const tokens = require(path.join(repoDir, "hub/tokens.cjs"));

const ENDPOINT = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const USER_AGENTS = [
  "Codex Subscription Router",
  "codex_cli_rs",
  "ChatGPT/1.0"
];

function safeLabel(account) {
  const raw = account.label ?? account.id;
  if (typeof raw === "string" && raw.includes("@")) {
    return raw.split("@")[0];
  }
  return raw;
}

async function probe() {
  const accounts = store.accounts();
  if (accounts.length === 0) {
    console.log("No accounts found in store.");
    console.log("PROB: BLOCKED");
    process.exit(0);
  }

  let anySuccess = false;
  const results = [];

  for (const account of accounts) {
    const accessToken = await tokens.accessTokenFor(account);
    const accountLabel = safeLabel(account);
    if (!accessToken) {
      console.log(`[Account: ${accountLabel}] No access token available`);
      continue;
    }

    console.log(`\n=== Probing Account: ${accountLabel} (id: ${account.id}) ===`);

    for (const ua of USER_AGENTS) {
      const headers = {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ua,
        "Accept": "application/json"
      };
      if (account.accountId) {
        headers["ChatGPT-Account-ID"] = account.accountId;
      }

      try {
        const response = await fetch(ENDPOINT, {
          method: "GET",
          headers
        });

        const status = response.status;
        const contentType = response.headers.get("content-type") || "unknown";
        let isJson = false;
        let keys = [];

        if (contentType.includes("application/json")) {
          try {
            const data = await response.json();
            isJson = true;
            if (data && typeof data === "object" && !Array.isArray(data)) {
              keys = Object.keys(data);
            } else if (Array.isArray(data)) {
              keys = [`Array(length=${data.length})`];
              if (data.length > 0 && typeof data[0] === "object") {
                keys.push(`element_keys: [${Object.keys(data[0]).join(", ")}]`);
              }
            }
          } catch {
            isJson = false;
          }
        } else {
          // Consume text to drain socket
          await response.text();
        }

        const success = status >= 200 && status < 300 && isJson;
        if (success) {
          anySuccess = true;
        }

        results.push({
          account: accountLabel,
          ua,
          status,
          contentType,
          isJson,
          keys,
          success
        });

        console.log(`  UA: "${ua}" -> Status: ${status}, Content-Type: ${contentType}, JSON: ${isJson}${isJson ? `, Keys: [${keys.join(", ")}]` : ""}`);
      } catch (err) {
        console.log(`  UA: "${ua}" -> Error: ${err.message}`);
        results.push({
          account: accountLabel,
          ua,
          status: 0,
          contentType: "error",
          isJson: false,
          keys: [],
          success: false,
          error: err.message
        });
      }
    }
  }

  console.log("\n----------------------------------------");
  if (!anySuccess) {
    console.log("PROB: BLOCKED");
    process.exit(0);
  } else {
    console.log("PROB: PASSED");
  }
}

probe().catch((err) => {
  console.error("Probe error:", err.message);
  console.log("PROB: BLOCKED");
  process.exit(0);
});
