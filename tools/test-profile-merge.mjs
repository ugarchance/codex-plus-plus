#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const { mergeProfiles } = require(path.join(repoDir, "hub/profile.cjs"));

let mismatches = 0;

function check(label, actual, expected) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  const pass = actualStr === expectedStr ||
    (typeof actual === "number" && typeof expected === "number" && Math.abs(actual - expected) < 1e-6);

  if (pass) {
    console.log(`[PASS] ${label}: expected = ${expectedStr}, actual = ${actualStr}`);
  } else {
    console.error(`[FAIL] ${label}: expected = ${expectedStr}, actual = ${actualStr}`);
    mismatches++;
  }
}

function symmetricDifference(setA, setB) {
  const diff = [];
  for (const a of setA) {
    if (!setB.includes(a)) diff.push(a);
  }
  for (const b of setB) {
    if (!setA.includes(b)) diff.push(b);
  }
  return diff;
}

console.log("==================================================");
console.log("TEST SUITE: Multi-Account Profile Merge Verification");
console.log("==================================================");
console.log("");
console.log("--- HAND-CALCULATED STREAK EXPECTATIONS ---");
console.log("Account A: active 2026-08-10, 2026-08-11, 2026-08-12 (3 days)");
console.log("           Streak ended on Aug 12 (4 days before asOf: 2026-08-16) -> isolated current = 0, longest = 3");
console.log("Account B: active 2026-08-12, 2026-08-13, 2026-08-14, 2026-08-15, 2026-08-16 (5 days)");
console.log("           Streak active up to Aug 16 -> isolated current = 5, longest = 5");
console.log("Combined:  2026-08-10, 11, 12 (merged: 300+150=450), 13, 14, 15, 16");
console.log("           7 continuous consecutive calendar days ending on 2026-08-16");
console.log("           -> MERGED LONGEST STREAK = 7, MERGED CURRENT STREAK = 7");
console.log("------------------------------------------");
console.log("");

// Fixtures
const accountA = {
  profile: {
    username: "ahmet",
    display_name: "Ahmet",
    profile_picture_url: "https://avatar/a.png"
  },
  stats: {
    lifetime_tokens: 1000,
    peak_daily_tokens: 500,
    current_streak_days: 0,
    longest_streak_days: 3,
    total_threads: 10,
    longest_running_turn_sec: 120,
    fast_mode_usage_percentage: 20,
    total_skills_used: 15,
    unique_skills_used: 4,
    most_used_reasoning_effort: "xhigh",
    most_used_reasoning_effort_percentage: 60,
    daily_usage_buckets: [
      { start_date: "2026-08-10", tokens: 100 },
      { start_date: "2026-08-11", tokens: 200 },
      { start_date: "2026-08-12", tokens: 300 }
    ],
    cumulative_daily_usage_buckets: [
      { start_date: "2026-08-10", tokens: 100 },
      { start_date: "2026-08-11", tokens: 300 },
      { start_date: "2026-08-12", tokens: 600 }
    ],
    weekly_usage_buckets: [
      { start_date: "2026-08-10", tokens: 600 }
    ],
    top_invocations: [
      { type: "skill", skill_id: "s1", skill_name: "tdd", plugin_id: null, plugin_name: null, usage_count: 10 },
      { type: "skill", skill_id: "s2", skill_name: "refactor", plugin_id: null, plugin_name: null, usage_count: 5 }
    ],
    workspace_rank: null,
    workspace_total_user_count: null
  },
  metadata: {
    stats_as_of: "2026-08-16",
    generated_at: "2026-08-16T12:00:00Z",
    stats_error: null
  },
  partial: false
};

const accountB = {
  profile: {
    username: "team",
    display_name: "Team",
    profile_picture_url: "https://avatar/b.png"
  },
  stats: {
    lifetime_tokens: 2000,
    peak_daily_tokens: 800,
    current_streak_days: 5,
    longest_streak_days: 5,
    total_threads: 20,
    longest_running_turn_sec: 300,
    fast_mode_usage_percentage: 50,
    total_skills_used: 25,
    unique_skills_used: 3,
    most_used_reasoning_effort: "xhigh",
    most_used_reasoning_effort_percentage: 40,
    daily_usage_buckets: [
      { start_date: "2026-08-12", tokens: 150 },
      { start_date: "2026-08-13", tokens: 250 },
      { start_date: "2026-08-14", tokens: 300 },
      { start_date: "2026-08-15", tokens: 400 },
      { start_date: "2026-08-16", tokens: 500 }
    ],
    cumulative_daily_usage_buckets: [
      { start_date: "2026-08-12", tokens: 150 },
      { start_date: "2026-08-13", tokens: 400 },
      { start_date: "2026-08-14", tokens: 700 },
      { start_date: "2026-08-15", tokens: 1100 },
      { start_date: "2026-08-16", tokens: 1600 }
    ],
    weekly_usage_buckets: [
      { start_date: "2026-08-10", tokens: 1600 }
    ],
    top_invocations: [
      { type: "skill", skill_id: "s1", skill_name: "tdd", plugin_id: null, plugin_name: null, usage_count: 20 },
      { type: "skill", skill_id: "s3", skill_name: "code-review", plugin_id: null, plugin_name: null, usage_count: 8 }
    ],
    workspace_rank: null,
    workspace_total_user_count: null
  },
  metadata: {
    stats_as_of: "2026-08-16",
    generated_at: "2026-08-16T12:00:00Z",
    stats_error: null
  },
  partial: false
};

console.log("--- T2: TWO-ACCOUNT MERGE ASSERTIONS ---");
const merged = mergeProfiles([accountA, accountB]);

// Identity controller
check("Controller username", merged.profile.username, "ahmet");
check("Controller display_name", merged.profile.display_name, "Ahmet");
check("Controller avatar", merged.profile.profile_picture_url, "https://avatar/a.png");

// Lifetime tokens: 1000 + 2000 = 3000
check("Lifetime tokens sum", merged.stats.lifetime_tokens, 3000);

// Total threads: 10 + 20 = 30
check("Total threads sum", merged.stats.total_threads, 30);

// Longest running turn: max(120, 300) = 300
check("Longest running turn max", merged.stats.longest_running_turn_sec, 300);

// Total skills: 15 + 25 = 40
check("Total skills used sum", merged.stats.total_skills_used, 40);

// Peak daily tokens: max(100, 200, 450, 250, 300, 400, 500) = 500
check("Peak daily tokens", merged.stats.peak_daily_tokens, 500);

// Daily buckets
check("Daily buckets count", merged.stats.daily_usage_buckets.length, 7);
check("Daily bucket 2026-08-12 tokens (merged 300+150)", merged.stats.daily_usage_buckets.find((b) => b.start_date === "2026-08-12")?.tokens, 450);

// Cumulative daily buckets
check("Cumulative buckets count", merged.stats.cumulative_daily_usage_buckets.length, 7);
check("Cumulative bucket 2026-08-16 final total", merged.stats.cumulative_daily_usage_buckets[6]?.tokens, 2200);

// Weekly buckets
check("Weekly bucket 2026-08-10 tokens (600+1600)", merged.stats.weekly_usage_buckets.find((b) => b.start_date === "2026-08-10")?.tokens, 2200);

// Streaks from merged daily calendar
check("Merged longest streak days", merged.stats.longest_streak_days, 7);
check("Merged current streak days", merged.stats.current_streak_days, 7);

// Fast mode percentage: (20*1000 + 50*2000) / 3000 = 40.0%
check("Fast mode weighted average %", merged.stats.fast_mode_usage_percentage, 40);

// Reasoning effort: "xhigh", (0.60*1000 + 0.40*2000) / 3000 = 1400/3000 = 46.666667%
check("Most used reasoning effort", merged.stats.most_used_reasoning_effort, "xhigh");
check("Most used reasoning effort %", Math.round(merged.stats.most_used_reasoning_effort_percentage * 100) / 100, 46.67);

// Top 5 invocations: s1=30, s3=8, s2=5
check("Top invocations count", merged.stats.top_invocations.length, 3);
check("Top invocation 1 (s1 tdd count)", merged.stats.top_invocations[0]?.usage_count, 30);
check("Top invocation 1 id", merged.stats.top_invocations[0]?.skill_id, "s1");
check("Top invocation 2 (s3 code-review count)", merged.stats.top_invocations[1]?.usage_count, 8);
check("Top invocation 3 (s2 refactor count)", merged.stats.top_invocations[2]?.usage_count, 5);

// Partial flag
check("Partial flag for complete merge", merged.partial, false);

console.log("");
console.log("--- T3: NEGATIVE TESTS ---");

// Test: Empty account list throws error
let emptyThrew = false;
try {
  mergeProfiles([]);
} catch (err) {
  emptyThrew = true;
  console.log(`[PASS] Empty account list throws expected error: "${err.message}"`);
}
if (!emptyThrew) {
  console.error("[FAIL] Empty account list did not throw!");
  mismatches++;
}

// Test: Single account key set symmetric difference
const singleMerged = mergeProfiles([accountA]);

const topInputKeys = Object.keys(accountA).sort();
const topOutputKeys = Object.keys(singleMerged).sort();
const topSymDiff = symmetricDifference(topInputKeys, topOutputKeys);
check("Top-level key symmetric difference count", topSymDiff.length, 0);

const statsInputKeys = Object.keys(accountA.stats).sort();
const statsOutputKeys = Object.keys(singleMerged.stats).sort();
const statsSymDiff = symmetricDifference(statsInputKeys, statsOutputKeys);
check("Stats key symmetric difference count", statsSymDiff.length, 0);

console.log("");
console.log("==================================================");
console.log(`TOTAL MISMATCHES: ${mismatches}`);
console.log("==================================================");

if (mismatches > 0) {
  process.exit(1);
}
