import { __test_failoverCode } from "../patch/patches/091-rate-limit-failover.mjs";

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
  const match = typeof actual === "number" && typeof expected === "number" && Math.abs(actual - expected) <= tol;
  if (match) {
    totalPassed++;
    console.log(`  [PASS] ${label}`);
    console.log(`         Expected : ${expected.toFixed(8)}`);
    console.log(`         Actual   : ${actual.toFixed(8)} (diff: ${Math.abs(actual - expected).toExponential(2)})`);
  } else {
    totalFailed++;
    console.log(`  [FAIL] ${label}`);
    console.log(`         Expected : ${formatVal(expected)}`);
    console.log(`         Actual   : ${formatVal(actual)}`);
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

function assertDeepEqual(label, actual, expected) {
  totalTests++;
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  const match = actualStr === expectedStr;
  if (match) {
    totalPassed++;
    console.log(`  [PASS] ${label}`);
    console.log(`         Expected : ${expectedStr}`);
    console.log(`         Actual   : ${actualStr}`);
  } else {
    totalFailed++;
    console.log(`  [FAIL] ${label}`);
    console.log(`         Expected : ${expectedStr}`);
    console.log(`         Actual   : ${actualStr}`);
  }
}

console.log("===============================================================");
console.log("           CODEX++ POOL STATS UNIT TEST SUITE                  ");
console.log("===============================================================\n");

// ---------------------------------------------------------------------------
// 0. EXTRACTION TEST
// ---------------------------------------------------------------------------
console.log("--- 0: _cxpPoolStats Extraction Test ---");

const failoverSource = __test_failoverCode("jsx", "React");
const START_MARKER = "/*_cxpPoolStats:start*/";
const END_MARKER = "/*_cxpPoolStats:end*/";

const startIdx = failoverSource.indexOf(START_MARKER);
const endIdx = failoverSource.indexOf(END_MARKER);

if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
  console.error("FAIL: Could not extract _cxpPoolStats between marker comments");
  process.exit(1);
}

const fnSource = failoverSource.slice(startIdx + START_MARKER.length, endIdx).trim();
const poolStats = new Function(`return (${fnSource.replace(/^function\s*_cxpPoolStats/, "function")})`)();

assertTruthy("0: _cxpPoolStats extracted successfully as a callable function", typeof poolStats === "function");

const now = 1700000000000;

// ---------------------------------------------------------------------------
// (a) Tumu usedPercent >= 100
// ---------------------------------------------------------------------------
console.log("\n--- (a): All usedPercent >= 100 ---");

const accsA = [
  { id: "acc-1", label: "Pro Account", usedPercent: 100, resetAt: now + 3600 * 1000 },
  { id: "acc-2", label: "Team Account", usedPercent: 120, resetAt: now + 1800 * 1000 },
  { id: "acc-3", label: "Plus Account", usedPercent: 105, resetAt: now + 7200 * 1000 }
];

const resA = poolStats(accsA, now);
assertEqual("(a) allKnownExhausted is true", resA.allKnownExhausted, true);
assertEqual("(a) earliestResetAt is minimum resetAt", resA.earliestResetAt, now + 1800 * 1000);
assertEqual("(a) known length equals accounts length", resA.known.length, 3);
assertClose("(a) avgRemainingPct is 100 - avg(usedPercent)", resA.avgRemainingPct, 100 - ((100 + 120 + 105) / 3));
assertEqual("(a) rows preserve order and count", resA.rows.length, 3);
assertEqual("(a) row 0 label is preserved", resA.rows[0].label, "Pro Account");
assertEqual("(a) row 0 usedPercent", resA.rows[0].usedPercent, 100);

// ---------------------------------------------------------------------------
// (b) One account usedPercent null
// ---------------------------------------------------------------------------
console.log("\n--- (b): One Account with usedPercent null ---");

const accsB = [
  { id: "acc-1", label: "Unknown Usage", usedPercent: null, resetAt: now + 600 * 1000 },
  { id: "acc-2", label: "Known 40%", usedPercent: 40, resetAt: now + 2400 * 1000 },
  { id: "acc-3", label: "Known 80%", usedPercent: 80, resetAt: now + 3600 * 1000 }
];

const resB = poolStats(accsB, now);
assertEqual("(b) known length is 2 (null excluded)", resB.known.length, 2);
assertEqual("(b) allKnownExhausted is false", resB.allKnownExhausted, false);
assertClose("(b) avgRemainingPct is 100 - (40+80)/2", resB.avgRemainingPct, 40);
assertEqual("(b) earliestResetAt includes all valid resetAt", resB.earliestResetAt, now + 600 * 1000);
assertEqual("(b) row 0 usedPercent is null", resB.rows[0].usedPercent, null);

// ---------------------------------------------------------------------------
// (c) Hepsi null
// ---------------------------------------------------------------------------
console.log("\n--- (c): All null ---");

const accsC = [
  { id: "acc-1", email: "user1@example.com", usedPercent: null, resetAt: null },
  { id: "acc-2", email: "user2@example.com", usedPercent: null, resetAt: null }
];

const resC = poolStats(accsC, now);
assertEqual("(c) known length is 0", resC.known.length, 0);
assertEqual("(c) avgRemainingPct is null", resC.avgRemainingPct, null);
assertEqual("(c) allKnownExhausted is false", resC.allKnownExhausted, false);
assertEqual("(c) earliestResetAt is null", resC.earliestResetAt, null);
assertEqual("(c) rows count is 2", resC.rows.length, 2);
assertEqual("(c) label falls back to email", resC.rows[0].label, "user1@example.com");

// ---------------------------------------------------------------------------
// (d) Bos dizi
// ---------------------------------------------------------------------------
console.log("\n--- (d): Empty Array ---");

const accsD = [];
const resD = poolStats(accsD, now);
assertDeepEqual("(d) rows is empty array", resD.rows, []);
assertDeepEqual("(d) known is empty array", resD.known, []);
assertEqual("(d) avgRemainingPct is null", resD.avgRemainingPct, null);
assertEqual("(d) allKnownExhausted is false", resD.allKnownExhausted, false);
assertEqual("(d) earliestResetAt is null", resD.earliestResetAt, null);

// ---------------------------------------------------------------------------
// (e) Negatif: resetAt string / boolean
// ---------------------------------------------------------------------------
console.log("\n--- (e): Negative resetAt string/boolean ---");

const accsE = [
  { id: "acc-1", label: "Str Date", usedPercent: 50, resetAt: "2026-08-17T14:00:00Z" },
  { id: "acc-2", label: "Bool Reset", usedPercent: 70, resetAt: true },
  { id: "acc-3", label: "Numeric Reset", usedPercent: 90, resetAt: now + 5000 * 1000 }
];

const resE = poolStats(accsE, now);
assertEqual("(e) resetAt string is coerced to null in rows[0]", resE.rows[0].resetAt, null);
assertEqual("(e) resetAt boolean is coerced to null in rows[1]", resE.rows[1].resetAt, null);
assertEqual("(e) resetAt number is retained in rows[2]", resE.rows[2].resetAt, now + 5000 * 1000);
assertEqual("(e) earliestResetAt ignores string/boolean and takes numeric minimum", resE.earliestResetAt, now + 5000 * 1000);

// ---------------------------------------------------------------------------
// Ekstra: Label Resolution Hierarchy & Non-array input
// ---------------------------------------------------------------------------
console.log("\n--- Extra: Label Hierarchy and Fallback Tests ---");

const accsExtra = [
  { id: "id-1", label: "Custom Name", email: "custom@example.com" },
  { id: "id-2", email: "onlyemail@example.com" },
  { id: "id-3" }
];

const resExtra = poolStats(accsExtra, now);
assertEqual("Extra 1: uses label when present", resExtra.rows[0].label, "Custom Name");
assertEqual("Extra 2: falls back to email when label absent", resExtra.rows[1].label, "onlyemail@example.com");
assertEqual("Extra 3: falls back to id when label and email absent", resExtra.rows[2].label, "id-3");

const resNull = poolStats(null, now);
assertDeepEqual("Extra 4: safe fallback for null accounts", resNull.rows, []);

// ---------------------------------------------------------------------------
// OZET RAPOR
// ---------------------------------------------------------------------------
console.log("\n===============================================================");
console.log(`TEST RESULT: Total: ${totalTests}, Passed: ${totalPassed}, Failed: ${totalFailed}`);
console.log(`TOTAL MISMATCHES: ${totalFailed}`);
console.log("===============================================================");

if (totalFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
