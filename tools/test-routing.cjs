const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Set up temporary USER_DATA_DIR for test isolation before loading modules
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-test-routing-"));
process.env.USER_DATA_DIR = testDataDir;

const routing = require("../hub/routing.cjs");

let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;

function formatVal(v) {
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  if (v === undefined) return "undefined";
  return JSON.stringify(v);
}

function assertEqual(label, actual, expected) {
  totalTests++;
  const match = actual === expected;
  if (match) {
    totalPassed++;
    console.log(`  [PASS] ${label}`);
    console.log(`         Expected : ${formatVal(expected)}`);
    console.log(`         Actual   : ${formatVal(actual)}`);
  } else {
    totalFailed++;
    console.log(`  [FAIL] ${label}`);
    console.log(`         Expected : ${formatVal(expected)}`);
    console.log(`         Actual   : ${formatVal(actual)}`);
  }
}

function assertClose(label, actual, expected, tol = 1e-9) {
  totalTests++;
  const diff = Math.abs(actual - expected);
  const match = diff <= tol;
  if (match) {
    totalPassed++;
    console.log(`  [PASS] ${label}`);
    console.log(`         Expected : ${expected.toFixed(8)}`);
    console.log(`         Actual   : ${actual.toFixed(8)} (diff: ${diff.toExponential(2)})`);
  } else {
    totalFailed++;
    console.log(`  [FAIL] ${label}`);
    console.log(`         Expected : ${expected.toFixed(8)}`);
    console.log(`         Actual   : ${actual.toFixed(8)} (diff: ${diff.toExponential(2)})`);
  }
}

function assertTruthy(label, condition, detail = "") {
  totalTests++;
  if (Boolean(condition)) {
    totalPassed++;
    console.log(`  [PASS] ${label} ${detail}`);
  } else {
    totalFailed++;
    console.log(`  [FAIL] ${label} ${detail}`);
  }
}

console.log("===============================================================");
console.log("             CODEX++ ROUTING ACCEPTANCE TEST SUITE            ");
console.log("===============================================================\n");

// ---------------------------------------------------------------------------
// T1. ELIGIBILITY MATRIX
// ---------------------------------------------------------------------------
console.log("--- T1: Eligibility Matrix Tests ---");
console.log("Policy Note: Whitelist policy. Unrecognized plan strings are excluded (false).");

const t1Cases = [
  { account: { id: "acc-free", planType: "free" }, expected: false, note: "free -> excluded" },
  { account: { id: "acc-go", planType: "go" }, expected: false, note: "go -> excluded" },
  { account: { id: "acc-plus", planType: "plus" }, expected: true, note: "plus -> included" },
  { account: { id: "acc-pro", planType: "pro" }, expected: true, note: "pro -> included" },
  { account: { id: "acc-team", planType: "team" }, expected: true, note: "team -> included" },
  { account: { id: "acc-business", planType: "business" }, expected: true, note: "business -> included" },
  { account: { id: "acc-edu", planType: "edu" }, expected: true, note: "edu -> included" },
  { account: { id: "acc-prolite", planType: "prolite" }, expected: true, note: "prolite -> included" },
  { account: { id: "acc-ent26", planType: "ent26" }, expected: true, note: "ent26 -> included" },
  { account: { id: "acc-null", planType: null }, expected: true, note: "planType null -> included (low priority)" },
  { account: { id: "acc-undef", planType: undefined }, expected: true, note: "planType undefined -> included (low priority)" },
  { account: { id: "acc-unknown", planType: "some_unrecognized_custom_tier" }, expected: false, note: "unrecognized plan string -> excluded (whitelist)" },
  { account: { id: "acc-learned-blocked", planType: "pro" }, learned: new Set(["acc-learned-blocked"]), expected: false, note: "learned ineligible -> excluded" },
  { account: { id: "acc-transient-limit", planType: "plus" }, learned: { "acc-transient-limit": "usageLimitExceeded" }, expected: true, note: "temporary usage limit does not permanently exclude Plus" },
  { account: { id: "acc-transient-429", planType: "plus" }, learned: { "acc-transient-429": "429_quota" }, expected: true, note: "legacy 429 quota marker does not permanently exclude Plus" },
  { account: { id: "acc-auth-blocked", planType: "plus" }, learned: { "acc-auth-blocked": "auth_ineligible" }, expected: false, note: "persistent auth ineligibility remains excluded" }
];

for (const c of t1Cases) {
  const actual = routing.isEligible(c.account, c.learned);
  assertEqual(`T1: ${c.note}`, actual, c.expected);
}

// ---------------------------------------------------------------------------
// T2. URGENCY SCORING FORMULA
// ---------------------------------------------------------------------------
console.log("\n--- T2: Urgency Scoring Formula Tests ---");
const now = 1700000000000;

// Scenario 1: remaining 50% (used 50%), 24 hours to reset, 0 credits -> 50 / 24 = 2.0833333333333335
const s1Window = { usedPercent: 50, resetsAt: now + 24 * 60 * 60 * 1000 };
const s1Expected = 50 / 24;
const s1Actual = routing.urgencyScore(s1Window, 0, now);
assertClose("T2 Scenario 1 (remaining 50%, 24 hours, 0 credits)", s1Actual, s1Expected);

// Scenario 2: remaining 50% (used 50%), 24 hours to reset, 2 credits (multiplier 1 + 0.15*2 = 1.3) -> (50/24)*1.3 = 2.7083333333333335
const s2Window = { usedPercent: 50, resetsAt: now + 24 * 60 * 60 * 1000 };
const s2Expected = (50 / 24) * 1.3;
const s2Actual = routing.urgencyScore(s2Window, 2, now);
assertClose("T2 Scenario 2 (remaining 50%, 24 hours, 2 credits -> multiplier 1.3)", s2Actual, s2Expected);

// Scenario 3: remaining 70% (used 30%), 12 hours to reset, 4 credits (cap 3 -> multiplier 1 + 0.15*3 = 1.45) -> (70/12)*1.45 = 8.458333333333334
const s3Window = { usedPercent: 30, resetsAt: now + 12 * 60 * 60 * 1000 };
const s3Expected = (70 / 12) * 1.45;
const s3Actual = routing.urgencyScore(s3Window, 4, now);
assertClose("T2 Scenario 3 (remaining 70%, 12 hours, 4 credits -> cap 3, multiplier 1.45)", s3Actual, s3Expected);

// Edge Cases: usedPercent >= 100 -> null; usedPercent == null -> Infinity; reset in the past -> clamped to min 1 min
assertEqual("T2 Edge 1: usedPercent 100% -> null (not eligible)", routing.urgencyScore({ usedPercent: 100 }, 0, now), null);
assertEqual("T2 Edge 2: usedPercent 110% -> null (not eligible)", routing.urgencyScore({ usedPercent: 110 }, 0, now), null);
assertEqual("T2 Edge 3: usedPercent null -> Infinity (low priority)", routing.urgencyScore({ usedPercent: null }, 0, now), Infinity);

// ---------------------------------------------------------------------------
// T3. ACCOUNT SELECTION (chooseAccount)
// ---------------------------------------------------------------------------
console.log("\n--- T3: chooseAccount Tests ---");

const pool3 = [
  { id: "acc-100-full", planType: "plus", usedPercent: 100, resetsAt: now + 24 * 3600 * 1000 },
  { id: "acc-free", planType: "free", usedPercent: 10, resetsAt: now + 24 * 3600 * 1000 },
  { id: "acc-plus-40", planType: "plus", usedPercent: 40, resetsAt: now + 24 * 3600 * 1000 }
];

const selected = routing.chooseAccount(pool3, null, null, now);
assertTruthy("T3: plus 40% chosen from 3-account pool", selected !== null && (selected.accountId === "acc-plus-40" || selected.account?.id === "acc-plus-40"));
console.log("  [REASON JSON]:", JSON.stringify(selected?.reason, null, 2));

// Excluded set test (when acc-plus-40 is excluded, no other eligible candidate remains)
const excludedSelected = routing.chooseAccount(pool3, new Set(["acc-plus-40"]), null, now);
assertEqual("T3 Excluded set: returns null when selected account is excluded", excludedSelected, null);

// Empty pool test
const emptySelected = routing.chooseAccount([], null, null, now);
assertEqual("T3 Empty pool: returns null", emptySelected, null);

// Tie-breaker test: short window usage & thread count
const poolTie = [
  { id: "acc-a", planType: "pro", usedPercent: 50, resetsAt: now + 24 * 3600 * 1000, shortUsedPercent: 30, threadCount: 2 },
  { id: "acc-b", planType: "pro", usedPercent: 50, resetsAt: now + 24 * 3600 * 1000, shortUsedPercent: 10, threadCount: 5 }, // lower short window
  { id: "acc-c", planType: "pro", usedPercent: 50, resetsAt: now + 24 * 3600 * 1000, shortUsedPercent: 10, threadCount: 1 }  // same short window, fewer threads
];
const tieSelected = routing.chooseAccount(poolTie, null, null, now);
assertEqual("T3 Tie-breaker: on equal urgency, short window first then thread count (acc-c)", tieSelected?.accountId, "acc-c");

// ---------------------------------------------------------------------------
// T4. ROUTING.JSON STORE & ATOMIC WRITES
// ---------------------------------------------------------------------------
console.log("\n--- T4: routing.json Store and Atomic Write Tests ---");

const testFile = routing.routingPath();
const initialData = {
  version: 1,
  threadOwner: { "thread-alpha": "acc-plus-40" },
  learnedIneligible: {
    "acc-transient": "429_quota",
    "acc-broken": "auth_ineligible"
  },
  autoRoute: true
};

routing.writeRouting(initialData);
const readBack = routing.readRouting();

assertEqual("T4: routing.json write/read roundtrip version", readBack.version, 1);
assertEqual("T4: routing.json threadOwner match", readBack.threadOwner["thread-alpha"], "acc-plus-40");
assertEqual("T4: transient quota marker is ignored on read", readBack.learnedIneligible["acc-transient"], undefined);
assertEqual("T4: persistent learnedIneligible match", readBack.learnedIneligible["acc-broken"], "auth_ineligible");
assertEqual("T4: routing.json autoRoute value", readBack.autoRoute, true);

routing.markIneligible("acc-plus-40", "usageLimitExceeded");
assertEqual("T4: usageLimitExceeded is not persisted", routing.readRouting().learnedIneligible["acc-plus-40"], undefined);
routing.markIneligible("acc-auth-blocked", "auth_ineligible");
assertEqual("T4: auth ineligibility is persisted", routing.readRouting().learnedIneligible["acc-auth-blocked"], "auth_ineligible");

// File permission mode check (0600)
const stats = fs.statSync(testFile);
const modeOctal = (stats.mode & 0o777).toString(8);
if (process.platform === "win32") {
  assertTruthy("T4: routing.json exists on Windows (NTFS ACLs replace POSIX mode bits)", fs.existsSync(testFile));
} else {
  assertEqual("T4: routing.json file mode 0600 (or 600 octal)", modeOctal, "600");
}

// Proof of atomic write in code
const sourceCode = fs.readFileSync(path.join(__dirname, "../hub/routing.cjs"), "utf8");
const hasAtomicTmp = sourceCode.includes(".tmp") && sourceCode.includes("renameSync");
assertTruthy("T4: tmp+renameSync atomic write structure present in code", hasAtomicTmp);

// ---------------------------------------------------------------------------
// T5. IDEMPOTENCY (learnThreadOwner)
// ---------------------------------------------------------------------------
console.log("\n--- T5: Idempotency Tests ---");

routing.learnThreadOwner("thread-beta", "acc-pro-1");
const contentAfterFirst = fs.readFileSync(testFile, "utf8");
const statAfterFirst = fs.statSync(testFile);

// Second call with identical data must not change file
routing.learnThreadOwner("thread-beta", "acc-pro-1");
const contentAfterSecond = fs.readFileSync(testFile, "utf8");
const statAfterSecond = fs.statSync(testFile);

assertEqual("T5: File content does not change after identical learnThreadOwner call (empty diff)", contentAfterSecond, contentAfterFirst);
assertEqual("T5: Second call does not modify file mtime (unnecessary I/O avoided)", statAfterSecond.mtimeMs, statAfterFirst.mtimeMs);

// ---------------------------------------------------------------------------
// T6. DOCS/ROUTING-ANCHORS.MD EXISTENCE AND RAW MATCHES
// ---------------------------------------------------------------------------
console.log("\n--- T6: docs/routing-anchors.md Document and Anchor Verification ---");

const docsPath = path.join(__dirname, "../docs/routing-anchors.md");
const docExists = fs.existsSync(docsPath);
assertTruthy("T6: docs/routing-anchors.md file exists", docExists);

if (docExists) {
  const docContent = fs.readFileSync(docsPath, "utf8");
  assertTruthy("T6: Surface I (Engine->View) present in document", docContent.includes("Surface I: Engine → View") || docContent.includes("Surface I: Engine -> View"));
  assertTruthy("T6: Surface II (Turn Error / Limit Banner) present in document", docContent.includes("Surface II: Turn Error") || docContent.includes("Surface II: Turn"));
  assertTruthy("T6: Surface III (New Chat UI) present in document", docContent.includes("Surface III: New Chat") || docContent.includes("Surface III: New Thread"));
  assertTruthy("T6: Raw grep -c outputs present in document", docContent.includes("grep -c"));
}

const failoverPatch = fs.readFileSync(
  path.join(__dirname, "../patch/patches/091-rate-limit-failover.mjs"),
  "utf8"
);
assertTruthy(
  "T6: transient usage limit is not persisted as learned ineligible",
  !failoverPatch.includes("markIneligible?.(_activeId")
);
assertTruthy(
  "T6: current failover still excludes the active account",
  failoverPatch.includes("routingSuggest?.(_self ? [_self] : void 0)")
);

// ---------------------------------------------------------------------------
// T7: chooseAccount exclusion forms
// ---------------------------------------------------------------------------
console.log("\n=== T7: chooseAccount exclusion forms ===");

const exclusionPool = [
  { id: "pro-1", planType: "pro", usedPercent: 39 },
  { id: "free-full", planType: "free", usedPercent: 100 },
  { id: "free-idle", planType: "free", usedPercent: 3 }
];
const pickOf = (excluded) => routing.chooseAccount(exclusionPool, excluded, {})?.accountId ?? null;

assertEqual("T7: no exclusion picks the eligible pro account", pickOf(null), "pro-1");
assertEqual("T7: string exclusion is honoured", pickOf("pro-1"), null);
assertEqual("T7: array exclusion is honoured", pickOf(["pro-1"]), null);
assertEqual("T7: excluding the exhausted active account still finds the alternate", pickOf(["free-full"]), "pro-1");
assertEqual("T7: Set exclusion is honoured", pickOf(new Set(["pro-1"])), null);

// ---------------------------------------------------------------------------
// SUMMARY REPORT
// ---------------------------------------------------------------------------
console.log("\n===============================================================");
console.log(`TEST RESULT: Total: ${totalTests}, Passed: ${totalPassed}, Failed: ${totalFailed}`);
console.log(`TOTAL MISMATCHES: ${totalFailed}`);
console.log("===============================================================");

// Cleanup test temp dir
try {
  fs.rmSync(testDataDir, { recursive: true, force: true });
} catch {}

if (totalFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
