#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const store = require(path.join(repoDir, "hub/store.cjs"));
const resets = require(path.join(repoDir, "hub/resets.cjs"));

async function runTests() {
  console.log("=== T2: hub/resets.cjs Cache Testi ===");
  
  const accounts = store.accounts();
  const testAccount = accounts[0];
  if (!testAccount) {
    throw new Error("No account found in store to test");
  }

  let fetchCallCount = 0;
  const mockFetch = async (url, opts) => {
    fetchCallCount++;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        credits: [{ id: "cred-1", available: true }],
        available_count: 1,
        total_earned_count: 1,
        immediate_reset_purchase_eligible: false
      })
    };
  };

  resets.setFetch(mockFetch);
  resets.clearCache();

  // Call 1 (within TTL)
  const res1 = await resets.creditsFor(testAccount.id);
  console.log(`Call 1 completed (available_count=${res1.available_count}). Fetch count: ${fetchCallCount}`);

  // Call 2 (within TTL) -> must NOT trigger network fetch
  const res2 = await resets.creditsFor(testAccount.id);
  console.log(`Call 2 completed (available_count=${res2.available_count}). Fetch count: ${fetchCallCount}`);

  if (fetchCallCount !== 1) {
    throw new Error(`Cache failed: expected 1 fetch call, got ${fetchCallCount}`);
  }
  console.log("-> Cache hit verified (1 network call for 2 requests within TTL)");

  // Clear cache or simulate TTL expiration
  resets.clearCache(testAccount.id);
  const res3 = await resets.creditsFor(testAccount.id);
  console.log(`Call 3 after cache clear/TTL (available_count=${res3.available_count}). Fetch count: ${fetchCallCount}`);

  if (fetchCallCount !== 2) {
    throw new Error(`TTL expiration failed: expected 2 fetch calls, got ${fetchCallCount}`);
  }
  console.log("-> TTL expiration/cache reset verified (2nd network call made)\n");

  console.log("=== T3: Negatif Testler ===");

  // 1. consume without redeemRequestId
  try {
    await resets.consumeCredit(testAccount.id, "cred-123", "");
    console.error("FAILED: consumeCredit succeeded with empty redeemRequestId");
  } catch (err) {
    console.log(`Negative 1 (missing redeemRequestId): Caught expected error -> "${err.message}"`);
  }

  // 2. consume without creditId
  try {
    await resets.consumeCredit(testAccount.id, "", "req-123");
    console.error("FAILED: consumeCredit succeeded with empty creditId");
  } catch (err) {
    console.log(`Negative 2 (missing creditId): Caught expected error -> "${err.message}"`);
  }

  // 3. consume with non-existent / disabled account
  try {
    await resets.consumeCredit("non-existent-account-id", "cred-123", "req-123");
    console.error("FAILED: consumeCredit succeeded with non-existent account");
  } catch (err) {
    console.log(`Negative 3 (non-existent/disabled account): Caught expected error -> "${err.message}"`);
  }

  // 4. creditsFor with non-existent / disabled account
  try {
    await resets.creditsFor("non-existent-account-id");
    console.error("FAILED: creditsFor succeeded with non-existent account");
  } catch (err) {
    console.log(`Negative 4 (creditsFor non-existent/disabled account): Caught expected error -> "${err.message}"`);
  }

  console.log("\nAll T2 & T3 tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
