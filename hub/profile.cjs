/**
 * Pure profile merge functions for multi-account WHAM profile statistics.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function calculateStreaks(dailyBuckets, asOfDate = null) {
  if (!dailyBuckets || dailyBuckets.length === 0) {
    return { current_streak_days: 0, longest_streak_days: 0 };
  }

  const activeDays = dailyBuckets
    .filter((b) => typeof b.tokens === "number" && b.tokens > 0 && typeof b.start_date === "string")
    .map((b) => b.start_date)
    .sort();

  if (activeDays.length === 0) {
    return { current_streak_days: 0, longest_streak_days: 0 };
  }

  const uniqueTimestamps = [...new Set(activeDays)]
    .map((d) => {
      const parts = d.split("-").map(Number);
      return Date.UTC(parts[0], parts[1] - 1, parts[2]);
    })
    .sort((a, b) => a - b);

  let longest = 0;
  let currentRun = 0;
  let prev = null;

  for (const t of uniqueTimestamps) {
    if (prev === null) {
      currentRun = 1;
    } else {
      const diffDays = Math.round((t - prev) / MS_PER_DAY);
      if (diffDays === 1) {
        currentRun++;
      } else if (diffDays > 1) {
        currentRun = 1;
      }
    }
    prev = t;
    if (currentRun > longest) {
      longest = currentRun;
    }
  }

  let currentStreak = currentRun;
  if (asOfDate && prev !== null) {
    const asOfParts = asOfDate.split("-").map(Number);
    const asOfTs = Date.UTC(asOfParts[0], asOfParts[1] - 1, asOfParts[2]);
    const diffFromAsOf = Math.round((asOfTs - prev) / MS_PER_DAY);
    if (diffFromAsOf > 1) {
      currentStreak = 0;
    }
  }

  return {
    current_streak_days: currentStreak,
    longest_streak_days: longest
  };
}

function mergeDailyBuckets(profiles) {
  const map = new Map();
  for (const p of profiles) {
    const buckets = p.stats?.daily_usage_buckets;
    if (!Array.isArray(buckets)) continue;
    for (const b of buckets) {
      if (!b || typeof b.start_date !== "string") continue;
      const tokens = typeof b.tokens === "number" ? b.tokens : 0;
      map.set(b.start_date, (map.get(b.start_date) || 0) + tokens);
    }
  }

  const dates = [...map.keys()].sort();
  return dates.map((date) => ({
    start_date: date,
    tokens: map.get(date)
  }));
}

function buildCumulativeDailyBuckets(dailyBuckets) {
  let running = 0;
  return dailyBuckets.map((b) => {
    running += b.tokens;
    return {
      start_date: b.start_date,
      tokens: running
    };
  });
}

function mergeWeeklyBuckets(profiles) {
  const map = new Map();
  for (const p of profiles) {
    const buckets = p.stats?.weekly_usage_buckets;
    if (!Array.isArray(buckets)) continue;
    for (const b of buckets) {
      if (!b || typeof b.start_date !== "string") continue;
      const tokens = typeof b.tokens === "number" ? b.tokens : 0;
      map.set(b.start_date, (map.get(b.start_date) || 0) + tokens);
    }
  }

  const dates = [...map.keys()].sort();
  return dates.map((date) => ({
    start_date: date,
    tokens: map.get(date)
  }));
}

function mergeInvocations(profiles) {
  const map = new Map();

  for (const p of profiles) {
    const invocations = p.stats?.top_invocations;
    if (!Array.isArray(invocations)) continue;
    for (const item of invocations) {
      if (!item) continue;
      const type = item.type || "skill";
      const key = `${type}:${item.plugin_id ?? ""}:${item.plugin_name ?? ""}:${item.skill_id ?? ""}:${item.skill_name ?? ""}`;
      const count = typeof item.usage_count === "number" ? item.usage_count : 0;

      if (!map.has(key)) {
        map.set(key, {
          type: item.type ?? "skill",
          plugin_id: item.plugin_id ?? null,
          plugin_name: item.plugin_name ?? null,
          skill_id: item.skill_id ?? null,
          skill_name: item.skill_name ?? null,
          usage_count: count
        });
      } else {
        const existing = map.get(key);
        existing.usage_count += count;
      }
    }
  }

  const list = [...map.values()];
  list.sort((a, b) => {
    if (b.usage_count !== a.usage_count) {
      return b.usage_count - a.usage_count;
    }
    const nameA = a.skill_name || a.plugin_name || "";
    const nameB = b.skill_name || b.plugin_name || "";
    return nameA.localeCompare(nameB);
  });

  return list.slice(0, 5);
}

function mergeReasoningEffort(validProfiles, totalLifetimeTokens) {
  const effortScores = new Map();

  for (const p of validProfiles) {
    const effort = p.stats?.most_used_reasoning_effort;
    const pct = typeof p.stats?.most_used_reasoning_effort_percentage === "number"
      ? p.stats.most_used_reasoning_effort_percentage
      : 0;
    const tokens = typeof p.stats?.lifetime_tokens === "number" ? p.stats.lifetime_tokens : 0;
    const weight = totalLifetimeTokens > 0 ? tokens : 1;

    if (effort) {
      const score = (pct / 100) * weight;
      effortScores.set(effort, (effortScores.get(effort) || 0) + score);
    }
  }

  let bestEffort = "none";
  let bestScore = 0;
  for (const [effort, score] of effortScores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestEffort = effort;
    }
  }

  const denominator = totalLifetimeTokens > 0 ? totalLifetimeTokens : (validProfiles.length || 1);
  const bestPercentage = (bestScore / denominator) * 100;

  return {
    most_used_reasoning_effort: bestEffort,
    most_used_reasoning_effort_percentage: bestPercentage
  };
}

function mergeFastModePercentage(validProfiles, totalLifetimeTokens) {
  if (validProfiles.length === 0) return 0;

  if (totalLifetimeTokens > 0) {
    let weightedSum = 0;
    for (const p of validProfiles) {
      const pct = typeof p.stats?.fast_mode_usage_percentage === "number" ? p.stats.fast_mode_usage_percentage : 0;
      const tokens = typeof p.stats?.lifetime_tokens === "number" ? p.stats.lifetime_tokens : 0;
      weightedSum += pct * tokens;
    }
    return weightedSum / totalLifetimeTokens;
  }

  let sum = 0;
  for (const p of validProfiles) {
    sum += typeof p.stats?.fast_mode_usage_percentage === "number" ? p.stats.fast_mode_usage_percentage : 0;
  }
  return sum / validProfiles.length;
}

function mergeProfiles(profiles, options = {}) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error("Cannot merge empty profile list");
  }

  const validProfiles = profiles.filter((p) => p && p.stats && typeof p.stats === "object");
  const isPartial = options.partial === true ||
    profiles.length !== validProfiles.length ||
    profiles.some((p) => p?.partial === true || p?.hasStatsError === true);

  if (validProfiles.length === 0) {
    throw new Error("No valid profiles with statistics available to merge");
  }

  const controller = profiles[0] || validProfiles[0];
  const mergedDaily = mergeDailyBuckets(validProfiles);
  const mergedCumulative = buildCumulativeDailyBuckets(mergedDaily);
  const mergedWeekly = mergeWeeklyBuckets(validProfiles);

  let totalLifetimeTokens = 0;
  let totalThreads = 0;
  let maxTurnDurationSec = 0;
  let totalSkillsUsed = 0;
  let maxUniqueSkills = 0;

  for (const p of validProfiles) {
    const s = p.stats;
    if (typeof s.lifetime_tokens === "number") totalLifetimeTokens += s.lifetime_tokens;
    if (typeof s.total_threads === "number") totalThreads += s.total_threads;
    if (typeof s.longest_running_turn_sec === "number" && s.longest_running_turn_sec > maxTurnDurationSec) {
      maxTurnDurationSec = s.longest_running_turn_sec;
    }
    if (typeof s.total_skills_used === "number") totalSkillsUsed += s.total_skills_used;
    if (typeof s.unique_skills_used === "number" && s.unique_skills_used > maxUniqueSkills) {
      maxUniqueSkills = s.unique_skills_used;
    }
  }

  let peakDailyTokens = 0;
  for (const b of mergedDaily) {
    if (b.tokens > peakDailyTokens) peakDailyTokens = b.tokens;
  }
  if (mergedDaily.length === 0) {
    for (const p of validProfiles) {
      if (typeof p.stats?.peak_daily_tokens === "number" && p.stats.peak_daily_tokens > peakDailyTokens) {
        peakDailyTokens = p.stats.peak_daily_tokens;
      }
    }
  }

  let latestAsOf = null;
  for (const p of validProfiles) {
    const asOf = p.metadata?.stats_as_of;
    if (asOf && (!latestAsOf || asOf > latestAsOf)) {
      latestAsOf = asOf;
    }
  }

  const streaks = calculateStreaks(mergedDaily, latestAsOf);
  const reasoning = mergeReasoningEffort(validProfiles, totalLifetimeTokens);
  const fastModePercentage = mergeFastModePercentage(validProfiles, totalLifetimeTokens);
  const topInvocations = mergeInvocations(validProfiles);

  const mergedStats = {
    lifetime_tokens: totalLifetimeTokens,
    peak_daily_tokens: peakDailyTokens,
    current_streak_days: streaks.current_streak_days,
    longest_streak_days: streaks.longest_streak_days,
    total_threads: totalThreads,
    longest_running_turn_sec: maxTurnDurationSec,
    fast_mode_usage_percentage: fastModePercentage,
    total_skills_used: totalSkillsUsed,
    unique_skills_used: Math.max(maxUniqueSkills, topInvocations.filter((i) => i.type === "skill").length),
    most_used_reasoning_effort: reasoning.most_used_reasoning_effort,
    most_used_reasoning_effort_percentage: reasoning.most_used_reasoning_effort_percentage,
    daily_usage_buckets: mergedDaily,
    cumulative_daily_usage_buckets: mergedCumulative,
    weekly_usage_buckets: mergedWeekly,
    top_invocations: topInvocations,
    workspace_rank: controller.stats?.workspace_rank ?? null,
    workspace_total_user_count: controller.stats?.workspace_total_user_count ?? null
  };

  const result = {
    profile: {
      username: controller.profile?.username ?? null,
      display_name: controller.profile?.display_name ?? null,
      profile_picture_url: controller.profile?.profile_picture_url ?? null
    },
    stats: mergedStats,
    metadata: {
      stats_as_of: latestAsOf || controller.metadata?.stats_as_of || null,
      generated_at: new Date().toISOString(),
      stats_error: isPartial ? "partial_results" : null
    }
  };

  result.partial = isPartial;

  return result;
}

module.exports = {
  calculateStreaks,
  mergeDailyBuckets,
  buildCumulativeDailyBuckets,
  mergeWeeklyBuckets,
  mergeInvocations,
  mergeReasoningEffort,
  mergeFastModePercentage,
  mergeProfiles
};
