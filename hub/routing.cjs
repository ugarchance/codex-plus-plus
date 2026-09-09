const fs = require("node:fs");
const path = require("node:path");

const store = require("./store.cjs");
const { usageWindowsForAccount } = require("./rate-limits.cjs");

// Pure logic constants
const CODEX_ELIGIBLE_PLANS = Object.freeze([
  "plus",
  "prolite",
  "pro",
  "team",
  "business",
  "self_serve_business_prolite",
  "self_serve_business_usage_based",
  "ent26",
  "enterprise_cbp_automation",
  "enterprise_cbp_usage_based",
  "enterprise",
  "edu"
]);

const BLOCKED_PLANS = Object.freeze(["free", "go"]);

const TRANSIENT_INELIGIBLE_REASONS = Object.freeze([
  "usageLimitExceeded",
  "429_quota",
  "rate_limited"
]);

const CREDIT_BOOST_FACTOR = 0.15;
const CREDIT_BOOST_CAP = 3;
const RESET_HORIZON_DEFAULT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms (168 hours)
const RESET_HORIZON_MIN_MS = 60 * 1000; // 1 minute in ms

function isLearnedIneligible(learned, id) {
  if (!learned || !id) return false;
  if (learned instanceof Set) return learned.has(id);
  if (Array.isArray(learned)) return learned.includes(id);
  if (typeof learned === "object") {
    const reason = learned[id];
    return Boolean(reason) && !isTransientIneligibleReason(reason);
  }
  return false;
}

function isTransientIneligibleReason(reason) {
  if (typeof reason !== "string") return false;
  return TRANSIENT_INELIGIBLE_REASONS.some(
    (candidate) => candidate.toLowerCase() === reason.trim().toLowerCase()
  );
}

function sanitizeLearnedIneligible(learned) {
  if (!learned || typeof learned !== "object" || Array.isArray(learned)) return {};
  return Object.fromEntries(
    Object.entries(learned).filter(([id, reason]) => id && !isTransientIneligibleReason(reason))
  );
}

function usageForAccount(account) {
  const usageWindows = usageWindowsForAccount(account);
  const fiveHour = usageWindows.fiveHour;
  const weekly = usageWindows.weekly;
  const other = usageWindows.other;
  const scoringWindow = [weekly, fiveHour, ...other].find(
    (window) => typeof window?.usedPercent === "number" && !Number.isNaN(window.usedPercent)
  ) ?? weekly ?? fiveHour ?? other[0] ?? null;
  const exhausted = [fiveHour, weekly, ...other].some(
    (window) => typeof window?.usedPercent === "number" && window.usedPercent >= 100
  );

  return { usageWindows, fiveHour, weekly, other, scoringWindow, exhausted };
}

function isEligible(account, learned = null) {
  if (!account) return false;

  if (account.id && isLearnedIneligible(learned, account.id)) return false;
  if (account.accountId && isLearnedIneligible(learned, account.accountId)) return false;

  const rawPlan = account.planType;
  if (rawPlan === null || rawPlan === undefined) {
    // null / undefined plan is eligible but lowest priority
    return true;
  }

  const plan = String(rawPlan).trim().toLowerCase();
  if (BLOCKED_PLANS.includes(plan)) return false;
  if (CODEX_ELIGIBLE_PLANS.includes(plan)) return true;

  // Unknown plan string: fail-closed policy (ineligible)
  return false;
}

function urgencyScore(window, credits = 0, now = Date.now()) {
  if (!window || typeof window !== "object") return null;

  const usedPercent = window.usedPercent;
  if (usedPercent === null || usedPercent === undefined) {
    return Infinity; // Eligible but lowest priority (distinct sentinel)
  }

  if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) {
    return null;
  }

  if (usedPercent >= 100) {
    return null; // Capacity exhausted
  }

  const remainingPercent = Math.max(0, 100 - usedPercent);

  let clampedMs;
  const rawReset = window.resetsAt ?? window.resetAt;
  if (rawReset !== null && rawReset !== undefined) {
    const resetMs = typeof rawReset === "number" ? (rawReset > 1e11 ? rawReset : rawReset * 1000) : now + RESET_HORIZON_DEFAULT_MS;
    const deltaMs = resetMs - now;
    clampedMs = Math.max(deltaMs, RESET_HORIZON_MIN_MS);
  } else {
    clampedMs = RESET_HORIZON_DEFAULT_MS;
  }

  const hoursUntilReset = clampedMs / (1000 * 60 * 60);
  const effectiveCredits = typeof credits === "number" && !Number.isNaN(credits) ? Math.max(0, credits) : 0;
  const creditMultiplier = 1 + CREDIT_BOOST_FACTOR * Math.min(effectiveCredits, CREDIT_BOOST_CAP);

  return (remainingPercent / hoursUntilReset) * creditMultiplier;
}

function isExcluded(excluded, id) {
  if (!excluded || !id) return false;
  if (typeof excluded === "string") return excluded === id;
  if (excluded instanceof Set) return excluded.has(id);
  if (Array.isArray(excluded)) return excluded.includes(id);
  if (typeof excluded === "object") return Boolean(excluded[id]);
  return false;
}

function chooseAccount(snapshots = [], excluded = null, learned = null, now = Date.now()) {
  const storeLearned = learned ?? read().learnedIneligible;

  const candidates = [];
  for (const account of snapshots) {
    if (!account || !account.id) continue;
    if (isExcluded(excluded, account.id) || (account.accountId && isExcluded(excluded, account.accountId))) continue;
    if (!isEligible(account, storeLearned)) continue;
    const usage = usageForAccount(account);
    if (usage.exhausted) continue;
    candidates.push(account);
  }

  if (candidates.length === 0) return null;

  const scored = candidates.map((acc) => {
    const usage = usageForAccount(acc);
    const hasKnownPlan = acc.planType !== null && acc.planType !== undefined;
    const hasKnownUsage = typeof usage.scoringWindow?.usedPercent === "number" && !Number.isNaN(usage.scoringWindow.usedPercent);

    let tier = 0;
    if (hasKnownPlan && hasKnownUsage) tier = 3;
    else if (!hasKnownPlan && hasKnownUsage) tier = 2;
    else if (hasKnownPlan && !hasKnownUsage) tier = 1;
    else tier = 0;

    const urgency = hasKnownUsage
      ? urgencyScore(usage.scoringWindow, acc.credits ?? 0, now)
      : null;

    return {
      account: acc,
      tier,
      urgency,
      shortUsedPercent:
        typeof usage.fiveHour?.usedPercent === "number"
          ? usage.fiveHour.usedPercent
          : typeof acc.shortUsedPercent === "number"
            ? acc.shortUsedPercent
            : 0,
      threadCount: typeof acc.threadCount === "number" ? acc.threadCount : 0,
      id: String(acc.id ?? ""),
      usage
    };
  });

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return b.tier - a.tier;

    if (a.urgency !== null && b.urgency !== null && a.urgency !== Infinity && b.urgency !== Infinity) {
      const diff = b.urgency - a.urgency;
      if (Math.abs(diff) > 1e-9) return diff;
    } else if (a.urgency !== null && a.urgency !== Infinity) {
      return -1;
    } else if (b.urgency !== null && b.urgency !== Infinity) {
      return 1;
    }

    if (a.shortUsedPercent !== b.shortUsedPercent) {
      return a.shortUsedPercent - b.shortUsedPercent;
    }

    if (a.threadCount !== b.threadCount) {
      return a.threadCount - b.threadCount;
    }

    return a.id.localeCompare(b.id);
  });

  const winner = scored[0];
  return {
    accountId: winner.account.id,
    account: winner.account,
    reason: {
      weeklyUsedPercent: winner.usage.weekly?.usedPercent ?? (winner.usage.fiveHour ? null : winner.usage.scoringWindow?.usedPercent ?? null),
      resetsAt: winner.usage.weekly?.resetAt ?? winner.usage.scoringWindow?.resetAt ?? winner.account.resetAt ?? winner.account.resetsAt ?? null,
      shortUsedPercent: winner.usage.fiveHour?.usedPercent ?? winner.account.shortUsedPercent ?? null,
      threadCount: winner.account.threadCount ?? 0,
      urgency: winner.urgency
    }
  };
}

// Limited IO zone: routing.json store
function storePath() {
  return path.join(store.userDataDir(), "routing.json");
}

const routingPath = storePath;

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    return {
      version: data.version ?? 1,
      threadOwner: typeof data.threadOwner === "object" && data.threadOwner !== null ? data.threadOwner : {},
      learnedIneligible: sanitizeLearnedIneligible(data.learnedIneligible),
      autoRoute: data.autoRoute !== false
    };
  } catch {
    return {
      version: 1,
      threadOwner: {},
      learnedIneligible: {},
      autoRoute: true
    };
  }
}

const readRouting = read;

function write(data) {
  const target = storePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, target);
}

const writeRouting = write;

function ownerOf(threadId) {
  const data = read();
  return data.threadOwner[threadId] ?? null;
}

function learnThreadOwner(threadId, accountId) {
  const data = read();
  if (data.threadOwner[threadId] === accountId) return data;
  data.threadOwner[threadId] = accountId;
  write(data);
  return data;
}

function forgetThreadOwner(threadId) {
  const data = read();
  if (!threadId || !(threadId in data.threadOwner)) return data;
  delete data.threadOwner[threadId];
  write(data);
  return data;
}

function setAutoRoute(enabled) {
  const data = read();
  const next = Boolean(enabled);
  if (data.autoRoute === next) return data;
  data.autoRoute = next;
  write(data);
  return data;
}

function markIneligible(accountId, reason = "ineligible") {
  if (!accountId) return read();
  // Quota/model limit events are temporary failover signals, not account eligibility facts.
  if (isTransientIneligibleReason(reason)) return read();
  const data = read();
  if (typeof data.learnedIneligible !== "object" || data.learnedIneligible === null || Array.isArray(data.learnedIneligible)) {
    data.learnedIneligible = {};
  }
  if (data.learnedIneligible[accountId] === reason) return data;
  data.learnedIneligible[accountId] = reason;
  write(data);
  return data;
}

function clearIneligible(accountId) {
  const data = read();
  if (typeof data.learnedIneligible !== "object" || data.learnedIneligible === null) {
    data.learnedIneligible = {};
  }
  if (accountId) {
    if (!data.learnedIneligible[accountId]) return data;
    delete data.learnedIneligible[accountId];
  } else {
    if (Object.keys(data.learnedIneligible).length === 0) return data;
    data.learnedIneligible = {};
  }
  write(data);
  return data;
}

module.exports = {
  CODEX_ELIGIBLE_PLANS,
  BLOCKED_PLANS,
  TRANSIENT_INELIGIBLE_REASONS,
  CREDIT_BOOST_FACTOR,
  CREDIT_BOOST_CAP,
  RESET_HORIZON_DEFAULT_MS,
  RESET_HORIZON_MIN_MS,
  isEligible,
  isTransientIneligibleReason,
  sanitizeLearnedIneligible,
  usageForAccount,
  urgencyScore,
  chooseAccount,
  storePath,
  routingPath,
  read,
  readRouting,
  write,
  writeRouting,
  ownerOf,
  learnThreadOwner,
  forgetThreadOwner,
  setAutoRoute,
  markIneligible,
  clearIneligible
};
