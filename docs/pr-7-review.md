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
5. Routing (52), pool statistics (56), weights (29), usage-window and reset-cache
   tests pass. All 19 patches apply to the previously extracted original Windows
   26.901 ASAR; all seven resulting JavaScript files parse successfully.
6. Repacked an isolated candidate and updated its executable integrity record.
   Backed up the isolated profile's auth/account files before launching it with
   a separate CODEX_HOME and debugging port 9356. The original Store app and
   installed Codex++ remained running and unchanged.
7. Read the previously extracted account-menu component, then verified the live
   profile trigger and open menu over CDP. Real mouse events opened nine menu
   rows; the weekly bar rendered a compact local weekday/time without `Resets`.
   Screenshot and DOM evidence stay in ignored `.build/pr7-account-menu.png` and
   `.build/pr7-ui-result.json` because they contain account information.
8. A delayed check retained the open account menu. Startup output contained zero
   `desktop_fetch_auth_401`, `account_info_token_unavailable`,
   `authenticatedAccountPresent=false`, `ReferenceError` or `TypeError` matches.
   Closed only the candidate process tree and restored its isolated auth/accounts.

This source-label fix does not itself change the displayed remaining percentage.
The earlier stale-account quota refresh issue was fixed separately in `8ea92b0`.
