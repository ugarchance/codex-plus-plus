const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  classifyWindow,
  normalizeRateLimits,
  usageWindowsForAccount
} = require("../hub/rate-limits.cjs");
const routing = require("../hub/routing.cjs");

function window(usedPercent, resetsAt, windowDurationMins) {
  return { usedPercent, resetsAt, windowDurationMins };
}

const primary = window(35, 1787828735, 300);
const secondary = window(14, 1788291042, 10080);
const dual = normalizeRateLimits({ primary, secondary });

assert.equal(classifyWindow({ windowMins: 300 }), "fiveHour");
assert.equal(classifyWindow({ windowMins: 10080 }), "weekly");
assert.equal(classifyWindow({ windowMins: 720 }), "other");
assert.deepEqual(dual.usageWindows.fiveHour, {
  source: "primary",
  usedPercent: 35,
  resetAt: 1787828735000,
  windowMins: 300
});
assert.deepEqual(dual.usageWindows.weekly, {
  source: "secondary",
  usedPercent: 14,
  resetAt: 1788291042000,
  windowMins: 10080
});
assert.equal(dual.usedPercent, 14, "legacy aliases prefer weekly usage");
assert.equal(dual.windowMins, 10080, "legacy aliases prefer weekly duration");
assert.equal(dual.shortUsedPercent, 35, "short usage remains available for routing");

const weeklyOnly = usageWindowsForAccount({
  planType: "pro",
  usageWindows: {
    fiveHour: null,
    weekly: { source: "primary", usedPercent: 42, resetAt: 1788291042000, windowMins: 10080 },
    other: []
  }
});
assert.equal(weeklyOnly.fiveHour, null, "weekly-only account has no synthetic five-hour window");
assert.equal(weeklyOnly.weekly.usedPercent, 42);

const unknown = normalizeRateLimits({
  primary: window(12, 1787828735, 720),
  secondary: null
});
assert.equal(unknown.usageWindows.fiveHour, null);
assert.equal(unknown.usageWindows.weekly, null);
assert.equal(unknown.usageWindows.other.length, 1);
assert.equal(unknown.usedPercent, 12, "unknown window still has a safe legacy fallback");

const legacyWeekly = usageWindowsForAccount({ usedPercent: 18, resetAt: 1788291042000, windowMins: 10080 });
assert.equal(legacyWeekly.weekly.usedPercent, 18);
assert.equal(legacyWeekly.fiveHour, null);

const exhaustedFiveHour = routing.chooseAccount([
  {
    id: "short-exhausted",
    planType: "plus",
    usageWindows: {
      fiveHour: { source: "primary", usedPercent: 100, resetAt: 1787828735000, windowMins: 300 },
      weekly: { source: "secondary", usedPercent: 10, resetAt: 1788291042000, windowMins: 10080 },
      other: []
    }
  },
  {
    id: "weekly-only",
    planType: "pro",
    usageWindows: {
      fiveHour: null,
      weekly: { source: "primary", usedPercent: 40, resetAt: 1788291042000, windowMins: 10080 },
      other: []
    }
  }
], null, {}, 1787810000000);
assert.equal(exhaustedFiveHour?.accountId, "weekly-only", "an exhausted five-hour window is not routable");

const weeklyOnlyRouting = routing.usageForAccount({
  id: "weekly-only",
  usageWindows: { fiveHour: null, weekly: { usedPercent: 40, resetAt: 1788291042000, windowMins: 10080 }, other: [] }
});
assert.equal(weeklyOnlyRouting.fiveHour, null);
assert.equal(weeklyOnlyRouting.scoringWindow.usedPercent, 40);

const accountMenuPatch = fs.readFileSync(
  path.join(__dirname, "../patch/patches/040-account-menu.mjs"),
  "utf8"
);
assert.match(accountMenuPatch, /`5h left`/);
assert.match(accountMenuPatch, /`Weekly left`/);
assert.match(accountMenuPatch, /flex w-full gap-1\.5/);
assert.doesNotMatch(accountMenuPatch, /progressbar/);
assert.doesNotMatch(accountMenuPatch, /% used/);
assert.doesNotMatch(accountMenuPatch, /planType===`pro`/);

console.log("Usage window tests passed: dual, weekly-only, compact cards, legacy and routing exhaustion cases.");
