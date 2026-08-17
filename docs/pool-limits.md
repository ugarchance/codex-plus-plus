# Pool Rate Limits and Weighted Capacity Model

## Overview

Codex++ aggregates multiple ChatGPT subscriptions into a single pool. Because different subscription tiers have vastly different rate limits, window durations, and message caps, an unweighted average or sum of percentages misrepresents remaining pool capacity (e.g., treating an 80% used Free account identically to an 80% used Pro account).

This document details the live measurement data, official reference pricing ratios, normalized weight table, mathematical aggregation formulas, and fail-open design principles used in Codex++.

## Live Measurement Data (2026-08-17)

Measurements captured directly via `codex app-server account/rateLimits/read` across live subscriptions:

| Account | Plan Type | Rate Limit Buckets | Window Duration (`windowDurationMins`) | Primary Usage | Secondary Window | Credits |
|---|---|---|---|---|---|---|
| Account 1 | `pro` | `codex`, `codex_bengalfox` | 10,080 mins (7 days / weekly) | 79% used | None | Available |
| Account 2 | `free` | `codex` | 43,200 mins (30 days / monthly) | 80% used | None | None |
| Account 3 | `free` | `codex` | 43,200 mins (30 days / monthly) | 3% used | None | None |

### Rate Limit Protocol Schema Reference

From `codex_app_server_protocol`:
- `RateLimitWindow`: `{ usedPercent: number, resetsAt: number, windowDurationMins: number }`
- `Snapshot`: `{ limitId, limitName, planType, primary, secondary }`
- `PlanType` enum: `free`, `go`, `plus`, `pro`, `prolite`, `team`, `self_serve_business_prolite`, `self_serve_business_usage_based`, `business`, `ent26`, `enterprise_cbp_automation`, `enterprise_cbp_usage_based`, `enterprise`, `edu`, `unknown`

The measured 4.28x difference in window duration (43,200 mins vs 10,080 mins) alongside distinct rate limit buckets reflects the underlying quota capacity differences between Free and Pro tiers.

## Official Reference Ratios

Official pricing and tier documentation:
- [ChatGPT Pricing and Plans](https://learn.chatgpt.com/docs/pricing)
- [OpenAI Help: ChatGPT Subscriptions and Usage Limits](https://help.openai.com/en/articles/11369540)

Official multiplier benchmarks:
- **Plus**: Baseline standard paid tier (~10x capacity relative to Free baseline).
- **Pro**: 5x to 20x multiplier over Plus (50x to 200x relative to Free baseline).
- **Pro Lite**: ~5x multiplier over Plus (50x relative to Free baseline).
- **Team / Business / Enterprise / Edu**: Same per-seat capacity as Plus (10x relative to Free baseline).
- **Free / Go**: Baseline quota (1x).

## Plan Weight Table

Weights are defined in `hub/weights.cjs` using lower-case normalized keys:

| Plan Type | Weight ($w_i$) | Capacity Tier / Multiplier Description |
|---|---|---|
| `pro` | 200 | Pro tier (~20x Plus capacity, 200x Free baseline) |
| `prolite` | 50 | Pro Lite tier (~5x Plus capacity, 50x Free baseline) |
| `plus` | 10 | Plus baseline standard paid capacity |
| `team` | 10 | Team workspace per-seat capacity |
| `business` | 10 | Business workspace per-seat capacity |
| `self_serve_business_prolite` | 50 | Self-serve Business Pro Lite tier (~5x Plus capacity) |
| `self_serve_business_usage_based` | 10 | Usage-based business seat capacity |
| `ent26` | 10 | Enterprise 2026 contract tier |
| `enterprise_cbp_automation` | 10 | Enterprise CBP automation seat capacity |
| `enterprise_cbp_usage_based` | 10 | Enterprise CBP usage-based seat capacity |
| `enterprise` | 10 | Enterprise workspace per-seat capacity |
| `edu` | 10 | Education workspace per-seat capacity |
| `free` | 1 | Free baseline quota tier |
| `go` | 1 | ChatGPT Go baseline quota tier |
| Unknown / null | 1 | Fail-open default weight |

## Capacity Aggregation Formulas

### 1. Weighted Average Remaining Percentage

In `patch/patches/091-rate-limit-failover.mjs` (`_cxpPoolStats`):

$$\text{avgRemainingPct} = \frac{\sum_{i=1}^{K} w_i \cdot (100 - \text{used}_i)}{\sum_{i=1}^{K} w_i}$$

Where:
- $K$ is the number of accounts with known usage (`typeof usedPercent === "number"`).
- $w_i = \text{planWeight} > 0 \ ? \ \text{planWeight} : 1$.
- If no account has known usage ($K = 0$), $\text{avgRemainingPct} = \text{null}$.
- When all weights $w_i$ are identical, the formula reduces directly to the unweighted arithmetic mean $100 - \frac{1}{K}\sum \text{used}_i$.

### 2. Profile Menu Aggregate Headroom

In `patch/patches/040-account-menu.mjs` (`_total`):

$$\text{totalHeadroomPct} = \text{round}\left( \frac{\sum_{i=1}^{N} w_i \cdot \text{left}_i}{\sum_{i=1}^{N} w_i} \right)$$

Where $\text{left}_i = \max(0, \text{round}(100 - \text{used}_i))$.

## Fail-Open and Decoupling Principles

1. **Fail-Open Default**: Any unmapped, unrecognized, or null plan type gracefully defaults to a weight of `1`. Non-numeric or non-positive weights fallback safely to `1`.
2. **Bundle Decoupling**: Plan weight mapping lives exclusively in `hub/weights.cjs`. Patches (`040-account-menu.mjs` and `091-rate-limit-failover.mjs`) do not hardcode plan type tables; they consume `_a.planWeight` supplied by the main process through `accountsSync()`.
