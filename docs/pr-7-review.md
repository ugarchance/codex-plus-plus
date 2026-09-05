# PR #7 merge review — 2026-09-05

## Decision matrix

| Change | Measurement | Decision |
|---|---|---|
| Preserve window source | Main changes a stored weekly `primary` source to `secondary`; reversed five-hour/weekly fixtures reproduce it. Percentages remain unchanged. | Accept. Preserve the supplied source with legacy defaults. |
| Stop persistent quota exclusions | A Plus account at 20% used with an old `usageLimitExceeded` marker cannot be selected; a new `429_quota` event is saved permanently. | Accept. Ignore transient markers on read and skip new writes. Keep auth/plan exclusions and 100% quota checks. |
| Remove renderer ineligibility side effect | Original PR edits a combined 091 patch; current main has split 091/092 and provider-aware behavior. | Port intent. Validate the native protocol anchor without rewriting its condition; keep current 092 rendering and provider guards. |
| Compact reset text | Existing date conversion and local-time formatting are unchanged; only redundant prefixes are removed. | Accept. Keep time today, `Tomorrow` plus time, and weekday plus time. |
| Tests and historical anchor notes | Existing PR assertions cover source ordering, transient markers and active-account exclusion. | Accept and extend recovery/exhaustion/no-write cases. Run routing and pool suites in Windows/Linux CI. |

## Evidence sequence

1. Read PR `a445cb6` against main after Claude PR #8 was merged. No feature was
   assumed already fixed from its age or previous CI status.
2. Against main, an isolated temporary routing store reported: weekly source
   `primary` became `secondary`; recovered-account selection was false; new
   transient persistence was true; persistent auth exclusion remained true.
3. Merged main into the PR branch. Resolved only the conflicting 091 patch using
   current semantic anchors and the split banner implementation. No old minified
   receiver name or compiler memo slot was restored.
4. The same reproduction after the port reports: source remains `primary`,
   recovered-account selection is true, new transient persistence is false,
   and persistent auth exclusion remains true.
5. Routing, usage windows, pool statistics, weights and reset-cache tests pass.
   Apply the full patch set to the previously extracted original Windows 26.901
   ASAR and parse all resulting bundles. Package an isolated candidate for the
   account-menu check; the original Store app and installed Codex++ remain intact.

This source-label fix does not itself change the displayed remaining percentage.
The earlier stale-account quota refresh issue was fixed separately in `8ea92b0`.
