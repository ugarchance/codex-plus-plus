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
* **Proposed Injection Point:** When rate limit triggers, invoke `globalThis.__codexpp?.markIneligible(currentAccountId, 'rate_limited')`.

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
| **Surface II: Turn Error** | `codex.modelLimitBanner.headline.noReset` & `codex.upsellBanner.plus...` | React i18n ID / Error String | `codex.modelLimitBanner...` (1) | `[10453689, 10455506]` & `[10426435, 10453689]` | `markIneligible` and UI failover recommendation |
| **Surface III: New Chat** | `{item:`new_thread`}` / `CKc` | Telemetry & UI Action Signature | `new_thread` (1) | `[12112423, 12113059]` | Auto-routing with `chooseAccount` |

All discovery slices were verified under `/tmp/codexpp-anchor-discovery/` and prepared for Round 2 patch development.
