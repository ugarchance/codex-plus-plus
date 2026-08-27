const FIVE_HOUR_TARGET_MINS = 300;
const FIVE_HOUR_TOLERANCE_MINS = 5;
const WEEKLY_TARGET_MINS = 10080;
const WEEKLY_TOLERANCE_MINS = 60;

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceName(source) {
  return source === "primary" || source === "secondary" || source === "legacy" ? source : "other";
}

function normalizeWindow(raw, source, { resetIsSeconds = false } = {}) {
  if (!raw || typeof raw !== "object") return null;

  const usedPercent = finiteNumber(raw.usedPercent);
  const rawReset = finiteNumber(resetIsSeconds ? raw.resetsAt : raw.resetAt ?? raw.resetsAt);
  const resetAt = rawReset === null ? null : (resetIsSeconds ? rawReset * 1000 : rawReset > 1e11 ? rawReset : rawReset * 1000);
  const windowMins = finiteNumber(raw.windowDurationMins ?? raw.windowMins);

  return {
    source: sourceName(source),
    usedPercent,
    resetAt,
    windowMins
  };
}

function classifyWindow(window) {
  const windowMins = window?.windowMins;
  if (!Number.isFinite(windowMins)) return "other";
  if (Math.abs(windowMins - FIVE_HOUR_TARGET_MINS) <= FIVE_HOUR_TOLERANCE_MINS) return "fiveHour";
  if (Math.abs(windowMins - WEEKLY_TARGET_MINS) <= WEEKLY_TOLERANCE_MINS) return "weekly";
  return "other";
}

function buildUsagePayload(windows) {
  const usageWindows = { fiveHour: null, weekly: null, other: [] };

  for (const window of windows) {
    if (!window) continue;
    const kind = classifyWindow(window);
    if (kind === "fiveHour" && !usageWindows.fiveHour) {
      usageWindows.fiveHour = window;
    } else if (kind === "weekly" && !usageWindows.weekly) {
      usageWindows.weekly = window;
    } else {
      usageWindows.other.push(window);
    }
  }

  const preferred = usageWindows.weekly ?? usageWindows.fiveHour ?? usageWindows.other[0] ?? null;
  return {
    usageWindows,
    usedPercent: preferred?.usedPercent ?? null,
    resetAt: preferred?.resetAt ?? null,
    windowMins: preferred?.windowMins ?? null,
    shortUsedPercent: usageWindows.fiveHour?.usedPercent ?? null,
    shortResetAt: usageWindows.fiveHour?.resetAt ?? null
  };
}

function normalizeRateLimits(rateLimits) {
  return buildUsagePayload([
    normalizeWindow(rateLimits?.primary, "primary", { resetIsSeconds: true }),
    normalizeWindow(rateLimits?.secondary, "secondary", { resetIsSeconds: true })
  ]);
}

function normalizeStoredUsageWindows(raw) {
  if (!raw || typeof raw !== "object") return null;

  const windows = [
    normalizeWindow(raw.fiveHour, "primary"),
    normalizeWindow(raw.weekly, "secondary"),
    ...(Array.isArray(raw.other) ? raw.other.map((window) => normalizeWindow(window, window?.source ?? "other")) : [])
  ].filter(Boolean);

  return buildUsagePayload(windows).usageWindows;
}

function usageWindowsForAccount(account) {
  const stored = normalizeStoredUsageWindows(account?.usageWindows);
  if (stored) return stored;

  const legacy = normalizeWindow(
    {
      usedPercent: account?.usedPercent,
      resetAt: account?.resetAt ?? account?.resetsAt,
      windowMins: account?.windowMins
    },
    "legacy"
  );
  return buildUsagePayload(legacy ? [legacy] : []).usageWindows;
}

function emptyUsage() {
  return buildUsagePayload([]);
}

module.exports = {
  FIVE_HOUR_TARGET_MINS,
  FIVE_HOUR_TOLERANCE_MINS,
  WEEKLY_TARGET_MINS,
  WEEKLY_TOLERANCE_MINS,
  classifyWindow,
  normalizeWindow,
  normalizeRateLimits,
  normalizeStoredUsageWindows,
  usageWindowsForAccount,
  emptyUsage
};
