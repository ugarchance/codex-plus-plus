# Tool verification and the gptugar quota discrepancy

2026-09-05. The user requested verification of Codex tools, especially file reads/writes, and investigation of an 87% versus 57% weekly-quota discrepancy. API keys were never included in diagnostic output. Tests ran under `%LOCALAPPDATA%/CodexPP-tools-usage-0905`; real auth/accounts/providers files were copied to its backup directory first.

## Quota: observation to cause

1. Read the public view in `hub/store.cjs` and the `hub/usage.cjs` → `hub/probe.cjs` data path. The local native gptugar record contained `usedPercent=43` and `usageAt=2026-08-23T16:38:21.117Z`. The displayed 57% was calculated as 100 minus that old 43%.
2. Started the official installed app-server with a separate, empty CODEX_HOME. The existing access token was passed only through stdin; no token refresh occurred. Token-account and stored-account hashes matched; `account/read` confirmed gptugar and the Pro plan. The main codex bucket from `account/rateLimits/read` reported a 10080-minute window, 14% used, and 86% remaining. Other limit buckets were inspected separately. The discrepancy was not caused by a different account or a Spark/Astra bucket. Evidence: `.build/provider-implementation/usage-discrepancy.json`.
3. The other connected Free account's token had expired on August 26. Against isolated files, the unchanged `usage.refreshAll(force)` failed with HTTP 401 during token refresh; gptugar's cached 43% used remained untouched. A credential error for one account aborted the entire collection loop. Evidence: `tools-usage/usage-before.json`.
4. Added an error boundary around each account's credential preparation. A failed account loses its stale percentage and receives a safe sign-in message; healthy accounts continue to the probe. Probe failures receive a distinct usage error. A later successful measurement clears the old error. The public store view exposes only safe error text, which appears in the profile menu and Providers → Accounts and usage.
5. Repeated the test with the same real accounts in isolation: gptugar refreshed to 14% used, the failed account became `usedPercent=null`, and collection no longer rejected (`usage-after.json`). Regression coverage checks failed accounts first/last, recovery, probe failure, and exclusion of private error details.
6. A later measurement in the candidate's real profile menu showed 83% remaining. Usage continued during investigation, so the live percentage changed. The Free row explicitly requested sign-in. The fix uses live API data; it does not hardcode 87%. Evidence: `quota-ui.json`, `quota-menu.png`.

## Tools: actual result matrix

Tests used the official installed codex.exe app-server, the Codex++ gateway, and the user's Go connection. Command approvals were restricted to six predetermined PowerShell commands in the test directory. The first measurement revealed that app-server wraps commands in a full PowerShell invocation; the approval filter was narrowly adjusted to that contract. The rejected initial attempt was not counted as a pass. Files were checked independently on disk; the model's success claim alone was insufficient.

| Operation | DeepSeek V4 Flash / Chat | GPT-5.6 Luna / Responses | MiniMax M2.7 / Messages |
|---|---|---|---|
| File read with random nonce verification | Passed | Passed | Passed |
| Create file and append a line | Passed | Passed | Passed in separate turns; dependent commands were misordered in one turn |
| Search file contents with rg | Passed | Passed | Passed |
| Command output / exit code | Six commands exited 0 | Six commands exited 0 | Six commands exited 0; this alone did not establish correct data |
| Long command and write_stdin | 6 exec + 1 stdin verified | 6 exec + 1 stdin verified | Long command completed; model did not use write_stdin |
| view_image | Not tested in this run | Passed: actual image, red/green/blue | Not tested in this run |
| Namespace function/custom conversion | Earlier live/unit tests passed | Native Responses passthrough | Earlier live/unit tests passed |

MiniMax issued Set-Content and Add-Content together in one turn; the appended line was subsequently overwritten. Its final response incorrectly claimed that both lines were present, while the file contained only one. This was not attributed to lost adapter output: all six command outputs and the actual file contents were retained. Repeating write → append → read across three separate turns verified both lines. Both the failed batch and successful serial result are retained. Reliable ordering of dependent operations by this model is not claimed.

Evidence directory: `.build/provider-implementation/tools-usage/`. Files: `tool-matrix.json`, `tools-deepseek-v4-flash.json`, `tools-gpt-5.6-luna.json`, `tools-minimax-m2.7.json`, `tools-minimax-m2.7-serial.json`, and `image-tool.json`.

## Limits of “all tools”

- The actual app-server tool schema for external cxp models includes exec_command, write_stdin, view_image, request_user_input, goal tools, and multi-agent tools. Native apply_patch is absent. Editing through commands is not an apply_patch test.
- Native Luna/Astra catalog entries have `apply_patch_tool_type=freeform`; external slugs do not automatically receive that metadata. A separate mock measurement showed that setting model_catalog_json in thread/start.config did not change the inventory (`catalog-spike.json`). The [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) specifies startup loading. Full tool parity is not claimed without changing the native catalog/startup path.
- Multi-agent operations, goal creation, user-input prompts, browser/connected-app actions, and remote tools with side effects were not executed. Chat/Messages still lack OpenAI hosted web_search support.
- These tests do not validate Windows sandbox setup. Controlled command execution used a separate directory and an exact command approval filter. User workspace files were not targeted.

## Checks

18 provider/usage tests passed, as did the usage-window matrix and 56 pool-stats checks. Syntax checks passed for 64 JavaScript files. The final compatibility check applied all 19 patches to the original source, parsed all seven resulting bundles, and compared them byte-for-byte with the packaged working files. Normal git diff --check passed.

## Final installation and live verification

1. Translated the five new documents, provider UI, and safe errors into English. Updated error assertions while retaining the Unicode SSE fixture. The first translation test exposed two remaining old-language regex expectations; both were corrected and all 18 tests passed. A source scan found no remaining Turkish text in the new documentation or implementation. Native upstream localization remains controlled by the user's locale.
2. Rebuilt app-initial, app-primary, and settings from their original sources, then repacked ASAR and updated the candidate's PE integrity record. Final bundle comparison passed for all seven modified files. The first CDP attempts preceded startup readiness or used an overly exact Settings label that omitted its keyboard shortcut; the harness now waits for live anchors and handles that measured label. These attempts were not counted as successful UI verification.
3. Verified the candidate's English Providers title, tabs, controls, and single inline navigation entry immediately after Analytics. A usage-tab attempt initially clicked above the clipped panel after the editor scrolled into view; explicitly bringing the target into view fixed the test navigation. This was a harness visibility issue, not a usage-fetch failure.
4. Backed up EXE/ASAR/hub and auth/accounts/providers before installing to the separate CodexPP directory. The initial copy encountered a Windows process-exit file lock. Confirmed no installed-copy process remained, then completed copying. Final backup: %LOCALAPPDATA%/CodexPP/backups/usage-isolation-20260905124604Z. Installed EXE/ASAR hashes matched the verified candidate; all 26 hub files matched the repository. State-file hashes stayed unchanged during installation.
5. Opened the installed executable with the user's normal profile and verified the actual UI. The model list contained 35 entries: 353px viewport / 2365px content. Real wheel input moved its scroll position from 0 to 2012; a second wheel gesture moved the outer panel from 145 to 293 and exposed the last model at y=678 within the 784px viewport. Password input remained empty and horizontal overflow was absent. Evidence: english-installed-ui.json and the updated provider-settings.png.
6. The real user's quota cache changed from 43% used (57% remaining) to 26% used (74% remaining) at the final measurement. The expired Free account showed a separate English sign-in error and unknown usage. Provider usage refreshed independently. The original auth file, saved account credentials, provider keys, and model/connection preferences were unchanged; only intended usage metadata refreshed. Evidence: final-integrity.json.
7. Delayed installed-app logs contained zero auth-401/token-unavailable/account-mismatch/ReferenceError/TypeError markers. The Store ASAR hash remained unchanged. Closed the debug process tree, restored the isolated test auth/account copies, and reopened the normal Codex++ profile without a debugging port. No commit or push was performed. The tool limitations above remain explicit; this installation does not claim full native tool parity for external models.
