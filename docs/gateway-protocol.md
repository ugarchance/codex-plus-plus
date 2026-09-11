# Local gateway protocol

> This file includes dated exploratory measurements. The implemented ChatGPT
> Web v2 behavior, identities, tool surface and current `codex 0.153.4` evidence
> are documented in [chatgpt-web-v2.md](chatgpt-web-v2.md). Where they differ,
> the v2 document and production tests are authoritative.

What the engine actually does when `openai_base_url` points at a loopback
server. Every line below was measured against
`/Applications/ChatGPT.app/Contents/Resources/codex` (client version
`0.151.0`, app build 26.825.51511) with a throwaway `CODEX_HOME`; the user's
`~/.codex` was never written to.

Measurement scripts: `tools/route-probe.mjs`, `tools/transport-probe.mjs`,
`tools/thread-config-probe.mjs`.

## The route is a top-level config key

```toml
openai_base_url = "http://127.0.0.1:<port>/backend-api/codex"
```

The engine appends its own path segments to that base — `/models`,
`/responses` — exactly as it does against `https://chatgpt.com/backend-api/codex`.
No `model_providers` table is needed to redirect the built-in provider, and no
restart of anything but the engine.

## The route can be set per thread instead

`ThreadStartParams.config` is a free-form object, and the engine honours
`openai_base_url` inside it. With the key **absent** from `config.toml` and
passed only in `thread/start`:

```
1x  GET  /backend-api/codex/responses  (upgrade)  -> 426
8x  POST /backend-api/codex/responses
0x  GET  /backend-api/codex/models
```

Responses traffic went to the loopback sink; the catalog did not. `model/list`
is a global call with no thread to carry the override, so it still answered
from upstream with its 8 rows.

This splits the two jobs cleanly:

- **Routing turns** needs no file mutation at all. Only the threads Codex++
  starts are redirected, and a stock `/Applications/ChatGPT.app` sharing the
  same `~/.codex` is untouched. There is no journal to keep and nothing to
  restore on uninstall.
- **Putting rows in the picker** cannot use the per-thread route. It needs
  either `openai_base_url` in `config.toml` (which is global, and catches the
  stock app too) or a renderer-side injection into the `model/list` result.

## The request still carries the caller's identity

Every request that reached the sink had:

| Header | Value |
|---|---|
| `authorization` | `Bearer …` (1760 bytes, the live account token) |
| `chatgpt-account-id` | present |
| `originator` | `codex_cli_rs`, or the client name passed to `initialize` |
| `version` | client version |
| `user-agent` | `<originator>/<version> (…)` |

This is the fact the whole design rests on: a gateway forwards the incoming
`Authorization` header upstream and the engine's own account selection —
including whatever `chatgptAuthTokens` put there — survives untouched. The
gateway never needs its own credential for native traffic.

## The transport negotiates down from WebSocket

The engine opens `/responses` as a **WebSocket upgrade** first, not as a POST.
`prefer_websockets: true` is in the model catalog row, but forcing it to
`false` changed nothing — the upgrade attempt happened either way.

Answering the upgrade with `426 Upgrade Required` is the negotiation signal.
The engine logs one `responses_websocket` error and then switches to HTTP for
the rest of the session:

```
1x  GET  /backend-api/codex/responses   (upgrade: websocket)  -> 426
8x  POST /backend-api/codex/responses
```

Returning `500` to the upgrade instead puts the engine into a reconnect loop
(`Reconnecting... 2/5`) and no POST ever arrives. The status code is the whole
difference.

## The POST body is zstd

| | |
|---|---|
| `content-type` | `application/json` |
| `content-encoding` | `zstd` |
| `accept` | `text/event-stream` |

30268 bytes on the wire, 85331 decompressed for a one-word prompt. Node 23's
`zlib` has no `zstdDecompressSync`; decode with the `zstd` CLI or a library.

Decompressed top level:

```
model, input, tool_choice, parallel_tool_calls, reasoning, store,
stream, include, prompt_cache_key, text, client_metadata
```

`input` is a flat array whose first element has `type: "additional_tools"` —
tool definitions travel inside `input`, not in the top-level `tools` array,
which was empty. `reasoning` is `{effort, context}`, `include` is
`["reasoning.encrypted_content"]`, `store` is `false`.

## The catalog is a plain list the gateway can extend

`GET /models?client_version=…` answers `{"models": [...]}`. Ten rows upstream;
each row carries `slug`, `display_name`, `context_window`, `max_context_window`,
`supported_reasoning_levels`, `multi_agent_version`, `tool_mode`,
`input_modalities`, `visibility`, `prefer_websockets` and friends.

A row cloned from `gpt-5.6-luna` with `slug: "chatgpt-web/probe"` appended to
that list came back through `model/list` as the 5th of 9 rows:

```
model/list rows=9  slugs=gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna,
                          gpt-daybreak-blue-latest, chatgpt-web/probe, gpt-5.5
```

So a gateway that proxies `/models` and appends its own rows puts models in the
picker without touching the asar.

`model/list` returns `{data, nextCursor}` — not `{models}`. Reading the wrong
key reports 0 rows and looks like the catalog was rejected.

## What the per-thread route does not cover

`turn/start` also takes a `model`, and it has no `config` field. So a thread
that started native can switch to a `chatgpt-web/*` model mid-conversation and
its turns would still go upstream, where that slug does not exist. Either every
thread carries the route, or the renderer restarts the thread when the picker
crosses into a web model.

## Decoding inside the hub

The Electron in `Codex++.app` runs Node **v24.14.0**, whose `zlib` has
`zstdDecompressSync` and `createZstdDecompress`. The gateway can read a request
body without adding a dependency; `hub/` stays dependency-free.

## Retry budget

`stream_max_retries` and `request_max_retries` are top-level config keys and
cap how many times a failing endpoint is re-attempted. Set them to 1 while
measuring; the default turns one broken response into eight sink hits.

## The ChatGPT web surface, measured

The account's ChatGPT web session was opened inside Electron on a private
`persist:codexpp-chatgpt` partition. It loads normally — no bot challenge, no
Cloudflare interstitial — so the browser side needs no external Chrome.

The composer carries one effort control: a button whose text is the current
level, backed by `[role="slider"]` with an ARIA range. Walking that slider with
arrow keys and reading its accessible label at each stop gave the account's real
ladder:

| index | label |
|---|---|
| 0 | Instant |
| 1 | Medium |
| 2 | High |
| 3 | Extra High |
| 4 | **Pro** |

`aria-valuemin=0`, `aria-valuemax=4` — five stops. An account without Pro
exposes fewer, and an account with no selector at all is a Luna-only account, so
the ladder is the capability probe: read it, do not assume it.

`chatgpt.com/backend-api/models` cannot stand in for this. It answers **403
with an HTML body** to a Codex bearer token, the same bot wall the usage
endpoint hits. The list is only observable from a signed-in browser session.

## The tool contract is one custom tool called `exec`

Measured on 2026-09-01 by recording a real upstream turn (`gpt-5.6-sol`, prompt "run
`echo codexpp-tool-probe`") through a loopback proxy that tees both directions.

Codex does not receive one Responses tool per capability. The 30 entries in `tools[]` are the
*model-facing* registry; the wire protocol carries a single **custom tool** named `exec` whose input
is JavaScript source:

```js
const r = await tools.exec_command({"cmd":"echo codexpp-tool-probe","workdir":"…","yield_time_ms":10000,"max_output_tokens":1000});
text(r.output);
```

The JS surface itself arrives as a `developer` item of type `additional_tools` in `input[]`, not in
`tools[]`. This is the `toolMode: "code_mode_only"` field on the model row.

### What the gateway has to emit

| # | event | payload |
|---|---|---|
| 1 | `response.output_item.added` | `item.type: "custom_tool_call"`, `status: "in_progress"`, `id: "ctc_…"`, `call_id: "call_…"`, `name: "exec"`, `input: ""` |
| 2 | `response.custom_tool_call_input.delta` | optional, `input` fragments |
| 3 | `response.custom_tool_call_input.done` | the complete JS source |
| 4 | `response.output_item.done` | the same item, `status: "completed"` |
| 5 | `response.completed` | closes the response |

### What comes back

Codex executes the script locally under its own sandbox and approval policy, then opens a **new**
`/responses` request on the same `prompt_cache_key`. Its `input[]` gains two items:

- `custom_tool_call` — an echo of what we sent, same `call_id`
- `custom_tool_call_output` — `{ call_id, output: [{ type: "input_text", text: … }] }`

So the correlation key for a tool round is `call_id`, and the conversation key stays
`prompt_cache_key`. A harness therefore needs to pause the in-flight ChatGPT turn, emit the
`custom_tool_call`, end that response, and resume when the follow-up request arrives with the
matching `call_id`.

## Full-harness prerequisites

Measured from the reference implementation (`miuuyy/codex-chatgpt-web`, MIT) and confirmed against
the live endpoints:

- `openai/tunnel-client` v0.0.12 publishes a `darwin-arm64` build (HTTP 200 on the release asset).
- A **Tunnel** must be created at `platform.openai.com/settings/organization/tunnels`.
- A plain **API key** on the same account authenticates the tunnel client (`--runtime-api-key
  file:…`). It is not charged for model usage.
- ChatGPT needs **Developer Mode**, then a **new custom connector** of type Tunnel, authentication
  `None`, permissions "Allow all actions".
- The tunnel is outbound only; it opens no inbound listener.

## Code Mode has to be switched on for an injected model

The engine decides Code Mode from the model's own metadata. `chatgpt-web/pro` is injected by the
renderer and is unknown to the engine's catalog, so real turns arrive with **no** `additional_tools`
item and any `exec` we emit comes back as:

```
{"type":"custom_tool_call_output","output":"unsupported custom tool call: exec"}
```

Two levers exist. `model_catalog_json` is a **path** to a JSON file (not inline JSON) and requires
the full `ModelInfo` shape — `shell_type` and the rest. The cheaper one is the feature flag pair the
engine's own error message names:

```jsonc
config: { features: { code_mode: true, code_mode_only: true } }
```

Measured 2026-09-01 with a loopback gateway that injects one `exec` call and answers with whatever
Codex ran:

```
==> exec çağrısı gönderildi call_id=call_73908210d12fdbac780622e342cca5e2
==> tool çıktısı alındı "Script completed\nWall time 0.1 seconds\nOutput:\ncodexpp-harness-ok"
```

So the Codex half of the harness needs no catalog file — only these flags on `thread/start`, which
patch 120 now injects next to `openai_base_url`. Set `CODEXPP_HARNESS_PROBE=1` on the hub to re-run
this check after an upstream update.

## ChatGPT's MCP handshake starts with a method the SDK does not implement

Measured 2026-09-01 while creating the `Codex Native2` plugin against a tunnel-backed stdio MCP
server.

ChatGPT opens with an OpenAI-specific probe before the standard handshake:

```json
{"jsonrpc":"2.0","id":"openai-mcp-discover","method":"server/discover",
 "params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28", …}}}
```

`@modelcontextprotocol/sdk` 1.30.0 does not implement `server/discover`, and neither does the
tunnel client's own `dev mcp-stub` — it answers `JSON RPC not handled: "server/discover"
unsupported`. **The correct reply is a JSON-RPC error**, not a success:

```json
{"jsonrpc":"2.0","id":"openai-mcp-discover","error":{"code":-32601,"message":"Method not found: server/discover"}}
```

A stub that answered `{"result":{}}` to everything made ChatGPT show a generic "Something went
wrong" banner on plugin creation, with no hint that the fault was ours. After returning the error,
the handshake continues normally:

`initialize` (protocolVersion `2025-11-25`, clientInfo `openai-mcp/1.0.0`) → a second `initialize`
→ `notifications/initialized` → `tools/list`.

Two things that looked like causes and were not:

- **Tunnel workspace scope.** `tunnel-client runtimes list` reports `workspace_ids: null` even when
  the control plane has one. `admin tunnels get <id>` is read-only, works with the runtime key, and
  showed the real edges — the workspace was attached all along.
- **Tunnel client version.** v0.0.13 exists; its release notes are empty and its commits are opaque
  syncs. The transport was never the problem: ChatGPT reached the local server through v0.0.12 four
  times before the handshake was fixed.

## The harness loop

`hub/turn-broker.cjs` sits between the two halves. One Codex `/responses` request ends in exactly
one of two ways:

- **a tool call** — ChatGPT asked for something, so the gateway emits the `custom_tool_call` frames
  and closes the response. Codex runs the script and opens a follow-up request carrying
  `custom_tool_call_output`; the gateway hands that to the broker, which resumes the waiting MCP
  call, and then waits again on the same browser turn.
- **the final answer** — the browser turn finished first, so the gateway streams the assistant
  message and ends the broker turn.

`hub/broker-socket.cjs` exposes the broker on a `0600` unix socket under the app's userData dir.
`hub/mcp-server.cjs` is what tunnel-client spawns: it speaks MCP on stdio, exposes one tool
(`codex_exec` — `{turn_token, cmd, …}`), and forwards each call over that socket. The turn token is
minted per Codex turn and is the only thing that binds an MCP call to a live turn; a stale token is
rejected with `no active Codex turn for this token`.

The MCP process needs a Node runtime. The app already ships one at
`Contents/Resources/cua_node/bin/node` (v24.19.0, with `zstdDecompressSync`), so nothing external is
required. `ELECTRON_RUN_AS_NODE=1` is not an option — the packaged app has that fuse disabled and
launches the full app instead.

`tools/test-harness-loop.mjs` covers gateway ↔ broker ↔ Codex with a stub session;
`tools/test-harness-mcp.mjs` adds the real MCP server and a client that speaks it the way ChatGPT
does. Both run a real `codex app-server` and assert the local command actually ran.

## ChatGPT freezes the connector's tool list at the version, not at call time

Measured 2026-09-01. The harness attached the connector, sent the prompt and then stalled: ChatGPT
answered "I'm trying it." and never called anything. Nothing was wrong on this side — the tunnel
reported `probe_status: ok`, and the installed server answered a direct `tools/list` with exactly
one tool:

```
serverInfo: {"name":"codexpp-native","version":"1.0.0"}
tool: codex_exec  required=["turn_token","cmd"]
```

The app's own developer page told the real story: its published version declared a single action,
`ping` — a leftover from the stub the connector was created against. ChatGPT serves the model the
**version's** action list, not whatever the MCP server answers now, so `codex_exec` did not exist as
far as the model was concerned.

The fix is the **Refresh** button on that developer page, which re-reads `tools/list` and cuts a new
version. So: after any change to the tool surface in `hub/mcp-server.cjs`, refresh the connector
before testing, or the model is working from the old contract.

What this rules out as a cause, so it does not get re-investigated: connector attachment, the
tunnel, the broker socket, the turn token, and the code-mode wiring were all correct while this
symptom lasted. `hub/mcp-server.cjs` appends every JSON-RPC method it receives to
`<userData>/harness/mcp.log`; an empty log during a turn means ChatGPT never called the server at
all, which is the fastest way to tell this failure from a broken loop.

## The connector is attached from the composer's mention menu

Measured 2026-09-01 in the app's own ChatGPT window over CDP.

Typing `@codex` in the composer opens a typeahead whose rows are `.__menu-item[tabindex="0"]` — but
that class also matches every sidebar row, 39 of them, so a document-wide query picks the wrong
element. The mention rows are the only ones wrapped in `[data-composer-plugin-impression-id]`; use
that as the anchor. The wanted row arrives with `data-highlighted` already set, so `Enter` alone
selects it; arrow keys are only a fallback.

The proof that the selection took is the pill `[data-id^="plugin:"][data-keyword="Codex Native2"]`
inside the composer's `form`. Nothing may clear the composer between `Enter` and that check —
select-all + delete removes the pill along with the text.

`document.body.innerHTML.includes("Codex Native2")` is **not** a check: the harness preamble names
the plugin, so it is true whether or not the connector is attached.

## Input has to bypass OS window focus

A harness turn runs behind whatever the user is doing, so the ChatGPT window usually does not hold
OS focus. In that state `webContents.insertText()` and the edit commands (`selectAll`, `delete`)
are silent no-ops — the composer stays empty while `document.activeElement` still points at it:

```
{"composer":true,"text":"","focus":false,"inComposer":true,"rows":0,"pills":0}
```

`webContents.sendInputEvent()` goes into the renderer's input pipeline instead and does not need
focus, exactly like CDP `Input.*`. Type with `{type:"char", keyCode:<character>}`, clear with
`Cmd+A` + `Backspace` as key events.

## The code-mode tool surface is not an input item

`toolSurfaceFrom()` looked for an `input` item of type `additional_tools`. There is none. The
surface is the `exec` tool's own `description` in the request's `tools` array, and it is ~496 KB —
far too large to forward into a ChatGPT prompt. It documents `ALL_TOOLS` (`{name, description}`
entries for the enabled nested tools) and the full `exec_command` signature.

So the model never needs to see it: `codex_exec` takes `{turn_token, cmd, workdir?, yield_time_ms?,
max_output_tokens?, tty?}` and `hub/mcp-server.cjs` writes the JavaScript itself — it picks
`exec_command` or `shell_command` out of `ALL_TOOLS`, calls it with the right argument shape, and
emits the result with `text()`. This follows miuuyy/codex-chatgpt-web (MIT), which resolved this
surface first.

## Temporary Chat cannot run the harness

> Historical account/UI observation, not the current product contract. The
> reference and later accounts may expose different behavior. As of the
> 2026-09-11 implementation, both modes default to verified Temporary Chat; an
> unavailable connector is a preflight error, never permission to save normal
> history. Saved history needs explicit user opt-in. See [current behavior and evidence](chatgpt-web-v2.md).

Measured 2026-09-01 in the app's own ChatGPT window over CDP.

The Temporary Chat page states it plainly: *"This chat will ignore memory, **plugins**, and custom
instructions, and it won't appear in your history."* Its composer `+` menu offers only built-ins —
Add photos & files, Web search, Visualize. No plugin is listed, and `Codex Native2` is absent from
the DOM.

A normal chat's `+` menu lists real plugins (Gmail, GitHub, Figma, Atlassian Rovo, …) under a
"Type to search plugins, files, folders & skills" field, and typing `Codex` surfaces
`Codex Native2`.

So the browser-only path and the harness path cannot share a chat kind:

| | Temporary Chat | Normal chat |
|---|---|---|
| plugins / connectors | ignored | available |
| memory, custom instructions | ignored | applied |
| appears in history | no | yes |

The harness therefore has to run in a normal chat, which means harness turns land in the user's
ChatGPT history and may be coloured by memory. The composer has an `Unpersonalized` control that is
worth measuring before accepting that as a cost.

Selector notes for the composer: the `+` button is `[data-testid="composer-plus-btn"]` and carries
`aria-expanded`. Its menu is **not** a `[role="menu"]` and is not a `body`-level portal — queries
for `[role="menu"]`, `[role="dialog"]` and `[data-radix-popper-content-wrapper]` all return zero
while the menu is open. Read the state from `aria-expanded`, and drive it with
`Input.dispatchMouseEvent`; a screenshot is the fastest way to see what the menu actually contains.
