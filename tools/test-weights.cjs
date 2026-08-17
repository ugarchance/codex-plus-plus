const { PLAN_WEIGHTS, weightFor } = require("../hub/weights.cjs");

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

function assertTruthy(label, condition) {
  totalTests++;
  if (Boolean(condition)) {
    totalPassed++;
    console.log(`  [PASS] ${label}`);
  } else {
    totalFailed++;
    console.log(`  [FAIL] ${label}`);
  }
}

console.log("===============================================================");
console.log("           CODEX++ PLAN WEIGHTS UNIT TEST SUITE                ");
console.log("===============================================================\n");

console.log("--- 1: Exports and Types ---");
assertTruthy("PLAN_WEIGHTS is an object", typeof PLAN_WEIGHTS === "object" && PLAN_WEIGHTS !== null);
assertTruthy("weightFor is a function", typeof weightFor === "function");

console.log("\n--- 2: Canonical Plan Weights ---");
assertEqual('weightFor("pro") === 200', weightFor("pro"), 200);
assertEqual('weightFor("prolite") === 50', weightFor("prolite"), 50);
assertEqual('weightFor("plus") === 10', weightFor("plus"), 10);
assertEqual('weightFor("free") === 1', weightFor("free"), 1);
assertEqual('weightFor("go") === 1', weightFor("go"), 1);
assertEqual('weightFor("business") === 10', weightFor("business"), 10);
assertEqual('weightFor("edu") === 10', weightFor("edu"), 10);
assertEqual('weightFor("enterprise") === 10', weightFor("enterprise"), 10);
assertEqual('weightFor("team") === 10', weightFor("team"), 10);
assertEqual('weightFor("self_serve_business_prolite") === 50', weightFor("self_serve_business_prolite"), 50);
assertEqual('weightFor("self_serve_business_usage_based") === 10', weightFor("self_serve_business_usage_based"), 10);
assertEqual('weightFor("ent26") === 10', weightFor("ent26"), 10);
assertEqual('weightFor("enterprise_cbp_automation") === 10', weightFor("enterprise_cbp_automation"), 10);
assertEqual('weightFor("enterprise_cbp_usage_based") === 10', weightFor("enterprise_cbp_usage_based"), 10);

console.log("\n--- 3: Case Insensitivity and Whitespace Normalization ---");
assertEqual('weightFor("PRO") === 200 (uppercase)', weightFor("PRO"), 200);
assertEqual('weightFor(" pro ") === 200 (trimmed)', weightFor(" pro "), 200);
assertEqual('weightFor("ProLite") === 50 (mixed case)', weightFor("ProLite"), 50);
assertEqual('weightFor(" Plus ") === 10 (trimmed mixed case)', weightFor(" Plus "), 10);
assertEqual('weightFor("FREE") === 1 (uppercase)', weightFor("FREE"), 1);

console.log("\n--- 4: Fallbacks and Invalid Inputs ---");
assertEqual("weightFor(null) === 1", weightFor(null), 1);
assertEqual("weightFor(undefined) === 1", weightFor(undefined), 1);
assertEqual('weightFor("xyz") === 1 (unknown plan)', weightFor("xyz"), 1);
assertEqual('weightFor("") === 1 (empty string)', weightFor(""), 1);
assertEqual('weightFor("   ") === 1 (whitespace string)', weightFor("   "), 1);
assertEqual("weightFor(123) === 1 (numeric input)", weightFor(123), 1);
assertEqual("weightFor({}) === 1 (object input)", weightFor({}), 1);
assertEqual("weightFor(true) === 1 (boolean input)", weightFor(true), 1);

console.log("\n===============================================================");
console.log(`TEST RESULT: Total: ${totalTests}, Passed: ${totalPassed}, Failed: ${totalFailed}`);
console.log(`TOTAL MISMATCHES: ${totalFailed}`);
console.log("===============================================================");

if (totalFailed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
