# Renderer Anchor Discovery and Documentation (WP1 Step B)

This document provides a semantic analysis, AST location mapping, raw match metrics, and Round 2 UI/patch development plan for key extension and intervention points (anchors) across the minified renderer bundle for Codex++ auto-routing and account failover infrastructure (WP1).

---

## 1. Discovery Methodology and Safety Boundaries

Full compliance with [AGENTS.md](file:///Users/ahmet/gpt-binary-patch-wt-wp1-routing/AGENTS.md) rules has been maintained:
1. **Original Application Untouched:** `/Applications/ChatGPT.app` is preserved strictly read-only.
2. **Temporary Workspace:** Packaging and parsing tooling (`acorn`, `acorn-walk`, `prettier`, `@electron/asar`) was installed in isolation under `/tmp/codexpp-anchor-discovery` without polluting the `patch/` directory.
3. **Bundle Source:** Extracted `webview/assets/app-initial-BqZ9AFkF.js` (13.96 MB, single line) from `/Applications/ChatGPT.app/Contents/Resources/app.asar` into temporary directory; AST parsing completed in 12 seconds.
4. **Meaning-Driven Anchors:** Minified variable/function names (`X0s`, `Z0s`, `Q0s`, `Rsn`, `Afs`) are never used as search inputs; React i18n IDs, protocol constants, error strings, and prop destructuring signatures are used instead.

---

## 2. Surface I: Engine → View Message Dispatch Point

### Role and Purpose
The engine (`codex app-server`) communicates with the renderer via inter-process JSON-RPC delivering responses (`result`), errors (`error`), and notifications (`notification`). Intercepting responses to `thread/start`, `thread/fork`, `thread/resume`, and `thread/unarchive` enables mapping the newly created or resumed thread ID to the currently active account (`learnThreadOwner` in `routing.json`).

### Anchor Candidates and Semantic Rationale

#### Anchor 1A (Recommended - Core RPC Response Dispatcher: `RequestClient.onResult`)
* **Semantic Rationale:** The `RequestClient` class managing the RPC request pool centralizes resolution (`resolve`/`reject`) of all server responses via the `mcp_request_enqueued` log constant and `onResult` / `onError` methods.
* **Anchor Pattern:**
  ```javascript
  Kp.debug(`Request completed`,{safe:{id:e,method:r.method
  ```
* **AST Range:** `[2443803, 2455808]` (entire RequestClient class); `onResult`: `[2444983, 2446100]`
* **Raw Match Count (`grep -c`):** `1`
* **Formatted Slice Path:** `/tmp/codexpp-anchor-discovery/AppServerRequestClient.js`
* **Proposed Injection Point:** In `onResult(e, t, n)` prior to `r.resolve(t)`: check `r.method` (`thread/start`, `thread/fork`, `thread/resume`, `thread/unarchive`), and if `t.thread?.id` exists, invoke `globalThis.__codexpp?.learnThreadOwner(t.thread.id, activeAccountId)`.

#### Anchor 1B (Alternative - Server → Client Request Dispatcher: Adjacent to Patch 010)
* **Semantic Rationale:** The `onRequest` hook utilized by Patch 010 (`010-external-auth-refresh.mjs`).
* **Anchor Pattern:**
  ```javascript
  case`currentTime/read`:this.dispatchMessageFromView(`mcp-response`,{hostId:this.hostId,response:{id:
  ```
* **AST Range:** `[3214623, 3218507]`
* **Raw Match Count (`grep -c`):** `1` (as a unique switch-case block)
* **Formatted Slice Path:** `/tmp/codexpp-anchor-discovery/method-onRequest.js`

### Risk Notes
* Injection at the `onResult` level is safest as it sits above all transport layers (IPC, Worker, WebSocket) and `r.method` directly preserves the enum value.

---

## 3. Surface II: Turn Error / Rate Limit / Quota Banner Surface

### Role and Purpose
When a model or account quota is exhausted, rate limit is reached, or turn is rejected due to plan limitations, warning banners rendered by the renderer are intercepted to allow instant auto-routing or failover to an alternative eligible account.

### Error Constant Discovery Scan
Constants identified across the bundle via keyword scanning:
* `codex.modelLimitBanner.headline.noReset`: `"You've hit your usage limit for {modelName}. Try again later, or start a new conversation with another model."`
* `codex.modelLimitBanner.headline.withReset`: `"You've hit your usage limit for {modelName}. Try again after {resetDate}, or start a new conversation with another model."`
* `codex.upsellBanner.plus.headline.noReset`: `"To continue using Codex, add credits or upgrade to Pro today."`
* `codex.upsellBanner.freeOrGo.headline`: `"Your rate limit resets on {resetDate}. To continue using Codex, upgrade to Plus today."`
* `codex.upsellBanner.workspaceUsage.ownerLimitReached.headline`: `"You've reached your usage limit. Increase your limits to continue using Codex"`

### Anchor Candidates and Semantic Rationale

#### Anchor 2A (Model-Specific Usage Limit Banner: `Q0s`)
* **Semantic Rationale:** React component rendered when usage limits are exceeded for a selected model. i18n React keys and string definitions are unique.
* **Anchor Pattern:**
  ```javascript
  id:`codex.modelLimitBanner.headline.noReset`
  ```
* **AST Range:** `[10453689, 10455506]` (1,817 bytes)
* **Raw Match Count (`grep -c`):** `1`
* **Formatted Slice Path:** `/tmp/codexpp-anchor-discovery/component-error-10454637.js`
* **Proposed Injection Point:** Add "Switch to another eligible account" action button alongside banner JSX output.

#### Anchor 2B (Account/Workspace Rate Limit & Upsell Banner: `Z0s`)
* **Semantic Rationale:** Banner component displayed on account rate limits, exhausted credits, or plan limits (Free, Go, Plus, Pro, Enterprise CBP).
* **Anchor Pattern:**
  ```javascript
  id:`codex.upsellBanner.plus.headline.noReset`
  ```
* **AST Range:** `[10426435, 10453689]` (27,254 bytes)
* **Raw Match Count (`grep -c`):** `1`
* **Formatted Slice Path:** `/tmp/codexpp-anchor-discovery/component-error-10443234.js`
* **Implemented Behavior:** When a rate limit triggers, exclude the active account only from the current failover suggestion. Temporary quota/model limits are not persisted as account ineligibility.
* **Windows 26.901 port:** patch 091 validates the `usageLimitExceeded` protocol
  anchor and retains native error handling without a persistent account side
  effect. Patch 092 renders the failover card from the separate primary bundle.
  External-provider guards and native Astra model selection remain in the
  current patches; the historical combined 091 implementation is not restored.

### Risk Notes
* Due to React Compiler memo slots (`t[N]`), hook/state injections prior to JSX return must strictly adhere to React dispatcher rules.

---

## 4. Surface III: New Chat UI Creation Path (Thread/Start)

### Role and Purpose
When the user starts a new conversation (`thread/start`), auto-routing policy must evaluate the most eligible account (`chooseAccount`) and switch the active account swiftly/silently before the creation request is dispatched.

### Anchor Candidates and Semantic Rationale

#### Anchor 3A (Recommended - UI New Chat Action Path: `CKc`)
* **Semantic Rationale:** Function called when the user initiates a conversation with or without a project from the command palette or new chat button. Matches `new_thread` telemetry constant.
* **Anchor Pattern:**
  ```javascript
  Lh(e,Xg,{item:`new_thread`});
  ```
* **AST Range:** `[12112423, 12113059]` (636 bytes)
* **Raw Match Count (`grep -c`):** `1`
* **Formatted Slice Path:** `/tmp/codexpp-anchor-discovery/function-CKc-newchat.js`
* **Proposed Injection Point:** At the start of `CKc`, if `autoRoute` is active, invoke `globalThis.__cxpAutoRoute?.()` to activate the account with the highest urgency score.

#### Anchor 3B (Alternative - Command Palette Launcher)
* **Semantic Rationale:** Command definition mapped to `CmdOrCtrl+N` / `CmdOrCtrl+Shift+O` shortcuts and menu entries.
* **Anchor Pattern:**
  ```javascript
  id:`codex.command.newThread`
  ```
* **AST Range:** `[3981577, 3982000]`
* **Raw Match Count (`grep -c`):** `1`
* **Formatted Slice Path:** `/tmp/codexpp-anchor-discovery/startConv-ref-1.js`

### Risk Notes
* The `CKc` function serves as the unified bottleneck for new conversations triggered from both UI buttons and keyboard shortcuts.

---

## 5. Raw Verification Evidence (grep -c Outputs)

The following commands were run against the extracted `app-initial-*.js` bundle file, verifying that each anchor matches uniquely (exactly 1 match):

```bash
$ grep -c "case\`currentTime/read\`:this.dispatchMessageFromView(\`mcp-response\`" /tmp/codexpp-anchor-discovery/app-initial-BqZ9AFkF.js
1

$ grep -c "id:\`codex.upsellBanner.plus.headline.noReset\`" /tmp/codexpp-anchor-discovery/app-initial-BqZ9AFkF.js
1

$ grep -c "id:\`codex.modelLimitBanner.headline.noReset\`" /tmp/codexpp-anchor-discovery/app-initial-BqZ9AFkF.js
1

$ grep -c "{item:\`new_thread\`}" /tmp/codexpp-anchor-discovery/app-initial-BqZ9AFkF.js
1

$ grep -c "id:\`codex.command.newThread\`" /tmp/codexpp-anchor-discovery/app-initial-BqZ9AFkF.js
1
```

---

## 6. Anchor Discovery Summary and Round 2 Injection Plan

| Surface | Selected Anchor | Anchor Type | Regex / String Match | AST Range | Round 2 Action |
|---|---|---|---|---|---|
| **Surface I: Dispatcher** | `RequestClient.onResult` / `currentTime/read` | Protocol Log / Method Signature | `currentTime/read` (1) | `[2444983, 2446100]` & `[3214623, 3218507]` | Auto-record via `learnThreadOwner` |
| **Surface II: Turn Error** | `codex.modelLimitBanner.headline.noReset` & `codex.upsellBanner.plus...` | React i18n ID / Error String | `codex.modelLimitBanner...` (1) | `[10453689, 10455506]` & `[10426435, 10453689]` | Transient active-account exclusion and UI failover recommendation |
| **Surface III: New Chat** | `{item:`new_thread`}` / `CKc` | Telemetry & UI Action Signature | `new_thread` (1) | `[12112423, 12113059]` | Auto-routing with `chooseAccount` |

All discovery slices were verified under `/tmp/codexpp-anchor-discovery/` and prepared for Round 2 patch development.

## 7. `thread/unarchived` handler shapes

Two shapes of this handler have shipped. The historical one destructures the
notification params:

```javascript
case`thread/unarchived`:{let{threadId:id}=params.params;
```

The current one calls the handler directly, wrapping the id in a branding
helper whose minified name changes between builds — `Il(` on Windows Store
`26.820.71523`, `Mm(` on macOS `26.825.51511`:

```javascript
case`thread/unarchived`:receiver.handleThreadUnarchived(Mm(params.params.threadId));
```

Patch `090-auto-routing-core` accepts exactly one of the two shapes and fails
closed if neither or both match. The direct variant injects the same
thread-owner learning hook immediately after the case label.

The wrapper is matched as an optional non-capturing group over the generic
identifier pattern, and the params receiver is captured and written back — the
patch never takes a minified name as input. Hardcoding `Il(` is what broke this
patch on macOS `26.825.51511`; the anchor is now the `thread/unarchived`
protocol constant plus the `.params.threadId` access, both of which carry
meaning.

---

## 6. Surface V: Open Thread and Per-Chat Account (patch 093, 26.901)

* **Open thread id:** the main layout passes `activeThreadId` (computed from the route kind: local/chatgpt thread → `conversationId`, remote → `taskId`, home → `null`) to a memoised child. Anchor: the prop destructuring `{activeThreadId:<n>}=<e>;` — exactly one match in `app-initial`, none in `app-primary`. The patch publishes the value as `globalThis.__cxpActiveThreadId` on every render, except the draft ids the home and side-panel routes carry (`new-conversation`, `panel-new-conversation`, produced by the entrypoint helper), which become `null`. Live check (26.901): the home screen publishes `null`; clicking a sidebar chat sends `thread/read`, `thread/resume`, `thread/turns/list`, `thread/items/list`, `thread/goal/get` and publishes that chat's UUID.
* **Request client:** `this.requestClient=<x>;let <y>=this.settings.restricted;` in the `AppServerManager` constructor (the anchor patch 121 also uses; both append after it). The wrapper only acts when the client is `globalThis.__cxpClients.local.requestClient`.
* **Enforcement:** `turn/start` with a `threadId` whose usable `routing.json` owner differs from the engine's login triggers `__cxpActivate(owner, {transient: true})` before the request is sent; the hub keeps the default account. A callback registered with `manager.addNotificationCallback(['turn/completed','turn/failed'], notify)` (stored in `manager.events.notificationCallbacks`; `notify` receives the `{method, params}` notification) restores the default once no turn is running; a chat change restores it too, unless a turn is running. `thread/start` and `thread/resume` are untouched (patch 090 auto-routing decides at start; resume is local).

---

## 7. Surface VI: Thread Header Account Picker and Copy-to-ChatGPT (patches 094/095, 26.901)

Measured on macOS 26.901.51231 (8109); both chunks are platform independent.

* **Header slots:** the header component (app-initial, contains `data-app-shell-header-layout`) reads registries created by a factory whose `entries$` sorts `{align, actionId, allowsThreadContentOverlap, node, order}` by `order`; end-aligned entries render inside `ms-auto flex shrink-0 items-center gap-1.5`, each wrapped in `pointer-events-auto flex shrink-0 items-center no-drag`. Registration is the `HeaderAction` component (`actionId, align, order, slotPosition, unifiedSlotPosition, children`), which writes on layout effect and removes on unmount.
* **Share registration:** `webview/assets/local-conversation-page-*.js`, one match: `HeaderAction{actionId:"codex-conversation-share", align:"end", order:100, unifiedSlotPosition:"main", children: Share({conversationId, hostId})}` inside the page component (`{clientThreadId, conversationId, isArchivedPreview}` props; `null` while `conversationId` is null). Patch 095 wraps it in a fragment with the picker registered at order 99 and keys both elements. The React namespace is captured from `(0,<ns>.useState)(null)` inside that component's window. Other header actions in the same slot: `unified-thread-actions` (order 0), `local-thread-summary-panel-toggle` (350). Remote and ChatGPT-mode pages register their own actions in other chunks and are out of scope.
* **Navigation bridge:** app-initial stores `{navigate, navigateToLocalConversation, pathname, prepareNavigation}` in an "AppNavigationSignalBridge" entry; the installer `.set(<store>,{navigate:…,navigateToLocalConversation:…,pathname:…,prepareNavigation:…})` matches once. `navigateToLocalConversation(conversationId)` resolves the thread path and pushes it. Patch 094 publishes the two callbacks as `globalThis.__cxpNavigation` from that installer.
* **Copy to ChatGPT:** `AppServerManager.forkConversationFromLatest({sourceConversationId, cwd, model})` builds `thread/fork` (`excludeTurns`, then a resume hydrates the copy). Throwaway measurement with a temporary CODEX_HOME and a loopback mock provider: a thread started with `modelProvider: cxp-external` persists `model_provider` in its rollout, and a stock engine fails `thread/resume` with `Model provider cxp-external not found`; `thread/fork` with a native model yields a thread with `provider: openai` and the copied turn, which the stock engine resumes. Patch 121 would re-route a fork whose model starts with `cxp/`, so patch 093 applies a one-shot `__cxpForkModel` override on `thread/fork` before patch 121's wrapper (093 installs after 121 and is therefore the outer wrapper). The native model comes from `config/read` (`config.model`), else the first non-`cxp/` entry of `model/list`.
* **Menu surface:** the header's content container carries `[contain:layout_paint]`, which clips absolutely and fixed positioned descendants, and the local page chunk has no `createPortal`; the picker therefore opens a `<dialog>` with `showModal()` (top layer), positioned under the trigger, with a transparent `::backdrop` and backdrop-click / Escape closing.

Live evidence (2026-09-09, macOS 26.901, fresh install with 23 patches, first semantics): on a pinned chat the trigger renders left of Share with the account in use and title `Using the … account: …`; the dialog lists both accounts with the check on the account in use; picking the other row records the owner and re-labels the trigger `Pinned to …`; reopening shows the check moved plus an `Automatic` row, and choosing it removes the owner. The same day the semantics changed to pin-only with turn-time transient switching (see Surface V), re-verified below. The home route renders no trigger. External flow with a loopback mock connection (saved and discovered through `__cxpProviders`, thread started on `cxp/custom/example`, one turn answered by the mock): the trigger shows the connection label, the menu shows `Runs on …` and `Continue with ChatGPT (copy)`; the copy opened a new thread with `route: null`, model `gpt-6-astra`, and the original prompt and answer visible. A copy attempted before any turn fails with the engine's `no rollout found for thread id …`, shown inline in the menu. Screenshots: [thread-account-header.png](thread-account-header.png), [thread-account-external.png](thread-account-external.png).

Live evidence for the pin-only semantics (2026-09-09, fresh install): pinning a chat from the header recorded the owner while `activeAccountId` and `defaultAccountId` stayed on the default and no activation ran; the profile menu kept its check on the default account and showed the `This chat` badge on the pinned one ([thread-account-menu.png](thread-account-menu.png)); a `turn/start` on a thread pinned to the other account produced exactly `activate(other, transient)` followed by `activate(default, transient)` once the request settled, with no running turn left behind; with the engine parked transiently on the other account, opening another chat restored the default; `Automatic` removed the pin. Account switches still leave `~/.codex/auth.json` untouched.
