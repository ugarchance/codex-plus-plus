# Architecture

## Summary

The Codex desktop app is an Electron **client**; the engine is a separate Rust
process (`codex app-server`) and the two speak JSON-RPC. For multiple
subscriptions there is a path the engine already supports; third-party
providers need a separate local gateway. Both live in one side process
(`codexpp-hub`) and appear as a single list in the UI.

| | Subscriptions | Providers |
|---|---|---|
| Mechanism | external auth (`chatgptAuthTokens`) | `model_providers` + local gateway |
| Proxy | no | yes |
| Configuration | at runtime, over RPC | `~/.codex/config.toml` |
| Credential storage | in memory, in the engine | on disk, in the hub |

## Proven: external auth

The engine's own description of `AuthMode`:

> `chatgptAuthTokens` — ChatGPT auth tokens are supplied by an external host
> app and are only stored in memory. Token refresh must be handled by the
> external host app.

And of `ChatgptAuthTokensRefreshParams`:

> Clients that manage multiple accounts/workspaces can use this as a hint to
> refresh the token for the correct workspace.

Verified live against a copy of `CODEX_HOME`:

```
account/read       → chatgpt, account A
account/login/start {type:"chatgptAuthTokens", accessToken, chatgptAccountId}
account/read       → chatgpt, account B
account/rateLimits/read → account B's limits
auth.json          → unchanged
```

No logout is needed, the switch is immediate, the engine emits
`account/login/completed` and `account/updated`, and `~/.codex/auth.json` is
never written. Nothing is persisted in this mode, so a restart returns the
engine to whatever `auth.json` holds — the hub re-applies the preferred account
on start.

`account/logout` behaves differently per mode: in `chatgpt` mode it **deletes**
`~/.codex/auth.json`, in `chatgptAuthTokens` mode it only clears memory. That
deletion is why logging out of the stock app signs you out of everything.

The schema marks this `[UNSTABLE] FOR OPENAI INTERNAL USE ONLY`. It can change
between releases; the symptom would be `account/login/start` returning an
error.

## Attachment points

`account/chatgptAuthTokens/refresh` is a **server → client** request. When the
engine gets a 401 it asks the host for a token. The desktop app knows the
method but the body is empty:

```js
case `currentTime/read`:
  this.dispatchMessageFromView(`mcp-response`, {hostId: this.hostId, response: {...}});
  break;
case `account/chatgptAuthTokens/refresh`:
case `attestation/generate`:
  break;
```

That is where patch 010 goes. The neighbouring `currentTime/read` shows the
response shape. The anchor is the method name — a protocol constant, so it does
not drift between minified builds.

`requestAttestation` defaults to `false` at initialize. Unless it is opted into,
`attestation/generate` never arrives.

## Patch surface

The weight sits outside the asar. The patch is re-applied on every Codex
update, so the part that touches the asar is kept small; everything else is
ordinary code under `hub/`.

| # | File | Method | Job |
|---|---|---|---|
| 010 | `webview/assets/app-initial-*.js` | anchor | answer the refresh request |
| 020 | `.vite/build/early-bootstrap.js` | append | start the hub and disable the in-app updater (`CODEX_SPARKLE_ENABLED=false`) |
| 030 | `.vite/build/preload.js` | append | expose `__codexpp` to the renderer |
| 040 | `webview/assets/app-*.js` + select | anchor | account block in the profile menu |
| 050 | `.vite/build/bootstrap-*.js` | anchor | skip the `setPath('userData')` call |
| 060 | `webview/assets/app-initial-*.js` | anchor | register the app-server client |
| 070 | `webview/assets/app-initial-*.js` | anchor | normalise `authMode` in the renderer |
| 080 | `.vite/build/src-*.js` | anchor | attach the auth token or verify equivalent upstream gates |
| 090 / 091 | `webview/assets/app-initial-*.js` | anchor | routing, thread ownership and quota notifications |
| 092 / 101 | `webview/assets/app-*.js` + select | anchor | quota banner and reset-credit selector |
| 100 / 110 | `.vite/build/preload.js` | append | reset-credit and profile bridges |
| 111 | `webview/assets/app-initial-*.js` | anchor | profile avatar stack |
| 120 | `webview/assets/app-initial-*.js` | anchor | route each thread through the gateway and append the ChatGPT Web rows |

In 26.901, account/usage/banner UI moved into `app-primary`, while the client
and notification listener remain in `app-initial`. Each UI patch selects its
chunk by an i18n constant. Cross-chunk routing helpers live on `globalThis`.
On Windows, `patch/windows-integrity.mjs` updates the copied executable's
embedded ASAR hash after packaging; on macOS, `patch/mac-integrity.mjs` rewrites
the `ElectronAsarIntegrity` hash in the copied `Info.plist`. Validation stays
enabled against the new archive on both platforms.

Files 020 and 030 have **unhashed** names — `package.json`'s `main` field calls
`early-bootstrap.js` by name — so no anchor search is needed; appending at the
file boundary is enough, and the marker prevents a second application.
`early-bootstrap.js` is 216 bytes on one line: the first code the app runs.

The rest are hashed and found by glob. Patch 080's glob matches two files, so
it narrows further with `select`, a string only the intended file contains.

Patch 050 is for macOS: the app calls `app.setPath('userData', …/Codex)` at
startup. Electron ignores it because the launcher already passed
`--user-data-dir`, but the call itself counts as reaching into another app's
data directory and raises a TCC permission prompt. The patch skips the call
when `--user-data-dir` was supplied.

Patches 070 and 080 exist because the auth mode leaks into UI decisions. The
renderer reads `authMode` from `account/updated` and the main process attaches
its bearer token only when `authMethod === "chatgpt"`; without normalising
`chatgptAuthTokens` in both places the app drops to the sign-in screen a few
seconds after a switch. In 26.901 the main process already accepts both modes;
080 checks the two native gates and retains its legacy transform for older builds.

`preload.js` runs with `contextIsolation` on, so the renderer is reached
through `contextBridge.exposeInMainWorld`. The existing bridge is
`electronBridge`, with IPC channels `codex_desktop:message-from-view` /
`...-for-view`.

## Where the hub lives

The hub sits **inside** the patched app:
`Codex++.app/Contents/Resources/hub/`. `early-bootstrap.js` loads it through
`process.resourcesPath`, so the path does not depend on the user and the app
stays self-contained — copying it to another machine is enough.

Credentials and the account record live under `USER_DATA_DIR`
(`~/Library/Application Support/CodexPP`), not inside the app, so accounts
survive deleting and re-patching the app.

## Account model

Two sources, one list:

- **Native account** — read live from `~/.codex/auth.json` on every read. Its
  id is the constant `native`. The hub never copies it into its own store and
  only writes back to `auth.json` when it has to refresh an expired token.
- **Hub accounts** — added through the login flow, stored with their refresh
  tokens in `accounts.json`.

If a hub account has the same `chatgptAccountId` as the native one, the native
entry wins and the duplicate is hidden.

Two ids describe selection: `activeAccountId` is what the engine is using right
now (reset to the native account at every start, because that is what the
engine reads from disk), and `defaultAccountId` is the user's explicit choice,
re-applied on start.

Signing out of an account never leaves the app without one. The order is
deliberate: switch to the remaining account first, then remove the credential.
For the native account "remove" means moving `~/.codex/auth.json` to a
timestamped backup under `USER_DATA_DIR`. Only when nothing is left does the
real `account/logout` run.

Per-chat accounts (patch 093): the main layout's `activeThreadId` prop is
published as `globalThis.__cxpActiveThreadId` (draft routes publish `null`).
The hub distinguishes the **default** account (`defaultAccountId`, what the
profile menu marks and new chats start on) from the engine's current login
(`activeAccountId`); `activate(id, {transient: true})` moves only the latter.
Pinning (profile menu 040, header picker 095) writes `routing.json`
`threadOwner` and nothing else. A wrapper on the local request client runs
`__cxpFollowThread` before `turn/start`: it moves the engine transiently to the
pinned owner (or to the default when the owner is missing, exhausted or learned
ineligible) and marks the turn as running. `turn/completed` / `turn/failed`
(a callback registered through the manager's `addNotificationCallback`) and
chat changes restore the default, but never while a turn is running, because a turn's later model calls
must keep their account. External-provider threads (`cxp/` models) are skipped.
The failover card (091) re-pins the chat to the account it switches to. The
native footer label reflects the engine's login and refreshes on the app's own
schedule, so it can briefly show the pinned account after a turn.

The thread header is slot based: chunks register actions through
`HeaderAction` (actionId, align, order, slotPosition) and the header renders
them sorted by order. Patch 095 registers `cxp-thread-account` (order 99)
next to Share (`codex-conversation-share`, order 100) in the
local-conversation-page chunk; its node is a self-contained picker whose menu
is a native `<dialog>` in the top layer, because the header clips descendants
with `contain: paint` and the chunk has no react-dom portal. For
external-provider chats (patch 121 route) it offers "Continue with ChatGPT
(copy)": `manager.forkConversationFromLatest` with a native model (patch 093
forces the model on `thread/fork` once) and `navigateToLocalConversation`
from the router bridge that patch 094 publishes as `globalThis.__cxpNavigation`.
External-provider threads (`cxp/` models) are skipped. The failover card (091)
re-pins the chat to the account it switches to, so a quota-limited owner is not
re-selected on the next turn.

## Per-account usage

Usage comes from the engine, not from a web endpoint. The hub spawns a
short-lived `codex app-server` in a temporary `CODEX_HOME`, logs into each
account in turn with `chatgptAuthTokens`, and reads
`account/rateLimits/read`. One process covers every account; results are cached
for a minute.

The obvious alternative — calling `chatgpt.com/backend-api/codex/usage`
directly — works only with a `codex_cli_rs` user agent and is behind bot
protection that starts returning HTML 403 pages. The engine path has neither
problem and reports exactly the number the app's own usage row shows.

The hub normalizes the protocol's `primary` and `secondary` windows into the
public `usageWindows` shape: `fiveHour`, `weekly`, and `other[]`. Classification
uses the server-reported duration, so a weekly-only Pro response is rendered as
one weekly row without inventing a 5h limit. The legacy top-level usage fields
remain populated from the preferred weekly, 5h, or unknown window in that order;
routing uses the same normalized windows and excludes an account when any known
window is exhausted.

## Provider layer

`ModelProviderInfo` exists in the engine with 18 fields: `base_url`, `env_key`,
`env_key_instructions`, `experimental_bearer_token`, `auth`, `aws`, `wire_api`,
`query_params`, `http_headers`, `env_http_headers`, `request_max_retries`,
`stream_max_retries`, `stream_idle_timeout_ms`, `websocket_connect_timeout_ms`,
`requires_openai_auth`, `supports_websockets`, `supports_standalone_web_search`.

Two constraints:

- `wire_api = "chat"` is not supported. The engine's error says: *"set
  `wire_api = "responses"` in your provider config"*. The gateway has to speak
  the Responses API; if the provider does not, translating is the hub's job.
- Built-in provider ids are protected: *"Built-in providers cannot be
  overridden."* Custom providers need their own names.

The engine supports `model_catalog_json`. The Windows 26.901 integration instead
merges enabled external rows at the desktop request-client `model/list` boundary.
`hub/provider-gateway.cjs` supplies per-thread `cxp-external` config without
rewriting the user's shared config. `hub/providers.cjs` holds encrypted
connections, model capabilities and pinned routes; `provider-wire.cjs` translates
streaming protocols and tool history. Patch 122 mounts the compact UI inside the
existing Settings content and adds its native navigation row below Analytics.
Its shadow root keeps provider styles out of the desktop shell. See
[provider contracts and limits](docs/providers.md).

### The ChatGPT Web gateway

Neither of those constraints ended up applying. The engine takes
`openai_base_url` **per thread**, in `ThreadStartParams.config`, so no custom
provider and no `config.toml` mutation is needed: patch 120 puts the hub's
loopback URL into every `thread/start`, and a stock ChatGPT.app sharing the same
`~/.codex` keeps talking to the real backend.

`hub/gateway.cjs` answers the engine's WebSocket upgrade with `426` to pull it
onto HTTP+SSE, reads the zstd request body only far enough to see `model`, and
streams everything that is not a `chatgpt-web/*` slug straight to
`chatgpt.com/backend-api/codex` with the incoming `Authorization` header
untouched — so account switching and auto-routing keep working through it.

The picker rows do not come from the catalog endpoint: `model/list` is a global
call with no thread to carry the override. Patch 120 appends them to the
`model/list` result inside the renderer instead, cloning a live row for its
shape. Measured protocol details are in `docs/gateway-protocol.md`.

### The harness

`chatgpt-web/pro-harness` runs the same browser turn in a normal chat with the
`Codex Native2` connector attached, so the model can reach the machine the Codex
task is running on. Four pieces carry one call:

- `hub/turn-broker.cjs` mints a token per Codex turn and parks the browser turn
  until either a tool call or the final answer arrives.
- `hub/broker-socket.cjs` publishes the broker on a `0600` unix socket in the
  app's userData directory.
- `hub/mcp-server.cjs` is a stdio MCP server exposing one tool, `codex_exec`.
  ChatGPT reaches it through the OpenAI tunnel; it forwards each call over the
  broker socket.
- `hub/tunnel.cjs` runs `tunnel-client` as a child of the hub, so the tunnel
  lives and dies with the app instead of being supervised outside it.

Codex advertises only the freeform `exec` gateway in code mode, so `codex_exec`
takes a shell command and the MCP server writes the JavaScript that reaches
`exec_command`. The model never sees the ~496 KB code-mode tool document.

## Collecting credentials

Each account needs a refresh token once. Rather than reimplementing OAuth, the
built-in login flow (`account/login/start {type:"chatgpt"}`) is run once per
account against a temporary `CODEX_HOME`, and the resulting `auth.json` is
taken into the hub's store. After that, refreshing is the hub's job.

## Generating the schema

```bash
/Applications/ChatGPT.app/Contents/Resources/codex app-server generate-json-schema --out ./schema --experimental
```

132 client → server methods, 10 server → client methods.
