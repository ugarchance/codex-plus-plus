# Astra / Windows 26.901 compatibility investigation (2026-09-05)

1. Baseline: clean working tree at 24c6ff7. Store package 26.901.5280.0, Electron app 26.901.41600. Source ASAR SHA-256: 6579c4326cccdb508d079ecc878ad4725451b2234370d2ed9d4db53939cf99c7. Store installation is read-only throughout this work.
2. Extracted source to ignored `.build/astra-0905/extracted`. Existing apply fails at 010: request id mapper has zero matches. Independent audit: 7/14 pass; 010, 040, 080, 090, 091, 101, 111 fail. The initial console audit is summarized here; `.build/astra-0905/final-anchor-audit.json` records the post-fix results.
3. Parsed bundles with temporary acorn/acorn-walk/prettier; extracted enclosing functions into `.build/astra-0905/readable`. The release split UI into app-initial and app-primary. Account menu, usage modal and quota banner moved to app-primary; account client/error listener/profile header remain in app-initial.
4. Astra is already supported upstream: announcement component matches `gpt-6-astra` and sets the model through `setModelAndReasoningEffort`. No hardcoded model addition is justified; carry the new upstream binary and assets into Codex++ and verify actual model/list and picker.
5. 010: onRequest now uses `sendAppServerResponse(method,{id:mapper(id),result})` instead of dispatchMessageFromView. 040: menu adds personalPlanLabel and petShortcut, retains the rendered nine-child array. 080: both token gates already accept chatgptAuthTokens upstream; verify that exact structure rather than applying a duplicate gate. 090: thread/unarchived mapper was hardcoded as Il in the old patch; capture it semantically. 091: banner and error listener must be patched in separate chunks. 111: header adds usernameTextSizeClassName; avatar container is unchanged.

Validation log continues below.

6. Live candidate initially aborts before bootstrap: Electron ASAR integrity expected header 3513f5f42033e21050e53648e23bd55a150496552a32ebaf7f910424947356b4, patched header 2c8607b532820f271d5e3bd592464f56d45b9e73894cab554344b94964ec9229. Electron documentation specifies the INTEGRITY/ELECTRONASAR PE resource. Update that resource in the writable copy after repacking; preserve integrity validation. Reference: https://www.electronjs.org/docs/latest/tutorial/asar-integrity .
| Patch | Purpose | Finding in the new build | Decision / rationale |
|---|---|---|---|
| 010 | Forward account token refresh to the hub | Response transport changed | Adapt; otherwise expired sessions cannot refresh |
| 020 | Start hub and disable the copy's internal updater | Applies | Keep; multi-account infrastructure depends on it |
| 030 | Renderer/hub IPC bridge | Applies | Keep |
| 040 | Subscription cards, usage, account selection | Moved to app-primary; two props added | Adapt; rendered child array is unchanged |
| 050 | Private Codex++ user-data directory | Applies | Keep for isolation from the original app |
| 060 | Account switching and startup restoration | Applies | Keep; startup-order test passed |
| 070 | Expose external ChatGPT-token sessions to the UI | Applies | Keep |
| 080 | Attach ChatGPT tokens in the main process | Upstream fixed both gates | Validate the new build; retain the fix for older builds |
| 090 | Select eligible accounts and track thread ownership | Minified mapper renamed | Adapt; capture mapper structurally |
| 091 | Mark quota failures and display a switch banner | Listener and banner are in separate bundles | Keep listener in 091; split banner into 092 |
| 100 | Reset-credit IPC bridge | Applies | Keep |
| 101 | Account/reset selection in the usage dialog | Moved to app-primary | Adapt; paid-plan wrapper uses the same component |
| 110 | Merge profile data through the hub | Applies | Keep |
| 111 | Profile account avatars and selection | One display prop added | Adapt; avatar render position is unchanged |
| Windows installer | Launch the new package | ASAR header integrity check aborts launch | Update the writable copy's PE integrity record to the new ASAR hash |

Recommendation: retain all feature patches. Patch 080 needs no code change in the new upstream build, but should remain as a small compatibility check with legacy fallback. Applicability, syntax, and the live screens listed below were verified.

7. PE triage: ChatGPT.exe SHA256 d71df4deed05bf1abcc45cb10577073a8ca2b12d0c7a222ad00933fead1e9b32. NtExecutableResource confirms one INTEGRITY/ELECTRONASAR record; Codex.exe and chrome.dll have none. Node + resedit parse the PE resource and update only its 64-byte hash; no code sections/fuses are changed. Original Store binary is untouched. Auth refresh behavior tests cover both response transports and all three success/missing/error outcomes. Synthetic PE tests verify exact byte scope, reparse, idempotence, legacy absence and mismatched-source rejection.
8. Isolated live test: LocalAppData/CodexPP-astra-0905-validation contains separate app, userData and CODEX_HOME. Original auth.json and accounts.json were backed up first. The clone initially ran new-user onboarding; cloned the existing global state and copied the existing windows.sandbox configuration value. No Windows elevation/setup was performed. The sandbox setup banner in this isolated CODEX_HOME is a test-environment limitation.
9. model/list returns gpt-6-astra, hidden=false, efforts low/medium/high/xhigh/max/ultra. CDP verified the composer trigger, opened Select model and selected the actual GPT-6 Astra row. Unlike the previous release, role=menuitemradio now exists. Navigation: visible composer button matching Astra -> menuitem aria-label=Select model -> menuitemradio with exact text GPT-6 Astra. Screenshot: .build/astra-0905/astra-picker.png.
10. Real account switch from cloned Free default to Pro succeeded. Profile menu renders two accounts, quota cards, routing and Cards/Bars controls. The profile header renders the two-account avatar stack and usage statistics; usage/billing settings render weekly quota and three reset credits. Screenshots: .build/astra-0905/accounts.png and profile.png. Reset credit consumption is intentionally not part of the smoke test.
11. All 15 patch steps apply, with unique semantic file selection; all six modified JS files parse. Checks: test-bundle-compatibility, test-auth-refresh, test-windows-integrity, startup restore, usage windows, pool stats (56), weights (29), profile merge and routing (41) pass.

12. Installed with the normal Windows installer into `%LOCALAPPDATA%/Programs/CodexPP`; previous app backed up to `%LOCALAPPDATA%/CodexPP/backups/CodexPP-20260905085712Z`. Installed EXE and ASAR hashes are identical to the verified candidate. Start Menu shortcut targets the installed ChatGPT.exe with the normal private CodexPP data directory. A second launch from the installed location passed globals/account-menu checks; Cards -> Bars kept the menu open and rendered two progressbars. Screenshot: .build/astra-0905/installed-bars.png.
13. Delayed logs for candidate and installed copy contain zero desktop_fetch_auth_401, account_info_token_unavailable, authenticatedAccountPresent=false, current_account_mismatch, ReferenceError, TypeError or hub-load failures. All 49 JS scripts and the PowerShell installer parse. Final bundle regression additionally confirms byte-for-byte agreement between final patch output and the live-tested extracted artifact.
14. Closed only the test processes and restored the isolated auth/account copies. Original auth.json, original accounts.json and Store ChatGPT.exe hashes remain unchanged. No commit or GitHub push performed. Original user preferences are preserved; testing used separate userData/CODEX_HOME.

Limits at initial installation: model-list/UI/auth smoke test, without a billed Astra completion or a deliberate quota-exhaustion run. The reset-credit modal is anchor/syntax-verified; usage/billing and credit listings were checked live, without redeeming credits. The updated Windows executable is a local modified copy and is not re-signed (see README).

Follow-up verification (2026-09-05): the installed app's own app-server completed a real `gpt-6-astra` / `low` turn with `ASTRA_OK_0905`, no error and no tool calls. Test userData/CODEX_HOME remained isolated. The Windows setup guard prevented the initial composer submission; the successful request used the renderer's existing app-server client. Current Pro billing UI reports $0 monetary credits, 21% weekly quota left, and three available full resets; account-specific IPC confirms Pro=3 and Free=0 reset credits before/after the message. No reset was redeemed. See [provider integration evidence and plan](provider-integration-plan.md) for the request, token-count evidence, screenshots, limitations and cleanup.
