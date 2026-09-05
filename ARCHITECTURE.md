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

In 26.901, account/usage/banner UI moved into `app-primary`, while the client
and notification listener remain in `app-initial`. Each UI patch selects its
chunk by an i18n constant. Cross-chunk routing helpers live on `globalThis`.
On Windows, `patch/windows-integrity.mjs` updates the copied executable's
embedded ASAR hash after packaging, retaining validation against the new archive.

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
