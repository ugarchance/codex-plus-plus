# ChatGPT Web v2 contract and validation

This document is the current contract for `chatgpt-web/sol` (Browser only) and
`chatgpt-web/sol-full` (Full). Older notes in `gateway-protocol.md` are historical
measurements and do not override this contract.

## Windows private-home preflight

For installed engine **0.153.4**, an existing setup-v5 Windows sandbox can be
adopted without provisioning the shared `CodexSandboxOffline/Online` accounts.
This is an explicit same-machine operation, not part of automatic home import.
Do not copy credentials between machines/users or into a repository. Do not
upgrade the marker version or assume that `ready` proves actual execution.

```powershell
. ./install/windows/sandbox-state.ps1
Copy-CodexSandboxState -SourceHome "$env:USERPROFILE\.codex" -DestinationHome "$env:LOCALAPPDATA\CodexPP\codex-home"
node tools/cdp-inspect.mjs 127.0.0.1 19333 sandbox-status
```

Prerequisites: verify the installed engine version, initialized private home,
existing compatible source setup, and no existing destination sandbox state
(an empty `.sandbox` directory is allowed). The operation refuses overlapping
homes, reparse paths, incompatible markers and overwrites. It copies only the
real marker and opaque encrypted credential file; no account password is reset,
secret is decrypted/logged, or original config/auth is changed. Protected ACLs
deny sandbox users access to credentials/marker. Read-only attributes prevent
this engine's destructive automatic provisioning/recovery paths from resetting
the machine-wide accounts. Do not clear those attributes to retry setup.

If source credentials rotate, the engine changes setup format, or firewall
requirements change, this snapshot can become stale. Fail closed and arrange
a reviewed re-adoption; there is no automatic sync or weaker-sandbox fallback.
`Destination already contains sandbox state` deliberately prevents overwriting
an active installation. Only native readiness, actual sandbox-user execution
and a denied out-of-workspace write close the setup check. These are not a
ChatGPT Full E2E pass. The [live log](chatgpt-web-live-20260910.md) records both.

Rollback: close Codex++ after its tasks drain; move only its adopted `.sandbox`
and `.sandbox-secrets` directories into a protected backup under its own data
directory. Do not delete/reset Windows sandbox users, alter the original home,
or relax ACLs. Removing the adoption returns private-home readiness to pending.
Normal reinstall preserves this private-home state; a fresh profile requires
explicit adoption again.

## Routing and identity

For an exactly matched retained chat, connector selection is inherited from the
proven binding; the composer pill is normally consumed on Send and is not a
reason to open the mention picker again. Missing binding is an explicit error.
Model/effort is still verified on every user message. Normal history may acquire
its initial `/c/<id>` URL, including the observed intermediate `/c/WEB:<uuid>`,
only while the accepted user and assistant identities remain bound. Another
saved conversation or provisional id is not accepted as completion. A failure
after submission drains generation before releasing the physical lease.

Desktop history annotations for generated assistant output are recorded with
the original logical turn id and the measured `content_item_kinds` shape. Exact
canonical prefix matching still checks content, developer changes and provenance;
unknown metadata or a mismatched turn causes full-context reconstruction rather
than silently dropping instructions or tool evidence.

Patch 119 adds a derived model catalog to the local engine's startup arguments.
The original native rows are preserved verbatim; only Web rows get explicit
tool mode and conservative Web limits. Full advertises plaintext v2 subagents
only when the native catalog supports them; Browser-only disables subagents. No global config or
auth file is written. An explicit user catalog is not replaced. The catalog is
prepared at startup: account/catalog changes require restarting the application.
The catalog and process-local `openai_base_url` flags must follow `app-server`:
engine 0.153.4 ignores the earlier root-level overrides when desktop MCP setup
adds a subcommand-local `-c`. Check native `model/list`, not just renderer rows:
the native Web description must agree with the catalog's actual protocol. A Full
turn has a 32800 effective context window at the conservative family setting,
not the generic fallback 258400. These are observed engine values, not provider
usage. The gateway also augments successful authenticated `/models` refreshes,
preserving native rows and upstream auth/errors; it does not remove model caches.

Startup without a readable bounded private native model cache leaves native
startup available and Web preflight blocked. If the hub route is not ready when
the engine starts, preflight reports `Web catalog transport was not ready at
engine startup; restart Codex++ after the hub is ready`. Explicit user catalog
or startup route overrides are not overwritten. Do not fix these errors by
editing shared config/auth or bypassing native sandbox setup.

Patch 120 routes local `thread/start`, `thread/resume` and `thread/fork` through
the loopback gateway, without forcing native code-mode flags. Native HTTP
requests pass through unchanged; `cxp/` retains its separate provider path. Remote
hosts are never sent to a local loopback address. A Web request fails before send
when the gateway is not ready. The first `model/list` waits a bounded three
seconds for the startup generation instead of caching an initial null route.

The transport keeps these identities separate:

- native thread id and logical turn id, read from `x-codex-turn-metadata`;
- HTTP tool-result round id, derived from that request and its call ids;
- browser conversation key, derived from thread, account, model family, mode,
  effort and compaction epoch;
- browser lease id, owned by exactly one active Web turn;
- compaction epoch, derived from the replacement-history checkpoint.

`prompt_cache_key` is retained as engine metadata but is not used as any of
those identities. A Full turn without thread id, turn id or a fresh turn token
fails closed.

Every logical user turn gets a new token. Repeated HTTP rounds belonging to that
same logical turn keep it. Terminal turns retain bounded tombstones, so a retry
cannot create a second browser submission or re-run an uncertain side effect.
Canonical history from an earlier turn may contain old tool outputs; those are
context evidence, not a continuation unless the exact logical turn is active.

## Context and compaction

`web-contract.cjs` normalizes instructions, system/developer/user/assistant
messages, tool calls and all corresponding results, workspace metadata, output
schema and image attachments. A retained chat receives a suffix only when the
previous canonical checkpoint is an exact prefix. Changed instructions,
developer/environment metadata, account, model or epoch require full context in
a fresh session. Transport-only completion status is ignored in prefix matching;
message ids, roles and content are not. Each logical turn still includes its new
transport token, even with a suffix; already-retained images are not reattached.
Prompt and attachment limits fail explicitly; no context is silently truncated.

Images remain attachments and are submitted through `DOM.setFileInputFiles`.
Without an explicit saved-history choice, both modes must prove the visible
Temporary Chat control; a URL query alone is insufficient. Connector availability depends on the account and privacy choice.
If Full cannot attach its connector there, it fails before submitting any task.
The user must review that choice themselves. There is no automatic normal
history fallback or personalization change. After explicit user consent, launch
Codex++ with the transient environment variable `CODEXPP_WEB_CHAT_HISTORY=normal`
to use saved chats. Without it (or with `temporary`), Temporary Chat is required;
unknown values fail. This option is not written to global config/auth, and a
history-mode change invalidates retained reuse. The user authorized the normal
chat live test on 2026-09-11; see the execution log for its actual outcome.

Composer characters, UTF-8 bytes, image bounds and output/platform reserves are
checked separately. Token accounting uses the reference's pinned `tiktoken@1.0.22`
`o200k_base` estimator, with bounded chunks; bytes are not counted as tokens.
This remains an estimate, not measured provider usage (which is null). Terminal
Web responses expose counts to the native compaction trigger, explicitly marked
`metadata.codexpp_usage.estimated=true`, with tokenizer and null provider usage.
Missing
tokenizer dependencies fail preflight; installers run the locked, script-free
hub dependency install. Web catalog limits
are the conservative lowest supported effort limits, not the native 272k limit.

`/responses/compact` is matched exactly. V1 produces replacement history; V2
emits the engine compaction item. Both advance the retained epoch and compile a
tool-free summarization prompt. An unsupported or unverifiable result is an
error, not a simulated normal completion. Active-tool handoff requires one exact
source binding and all outstanding call results. It validates the entire batch
before delivery, stops queued/future work through the reserved control path,
preserves already-dispatched results and waits for physical browser settlement.
Only then may a tool-free checkpoint replace history and advance the epoch.
Missing-result or source mismatch leaves the original authority intact.
Idle v2 checkpoint/continuation has live evidence; active handoff has production
contract tests and a real-engine local fixture, which is not live GPT evidence.
Consult the dated execution log for current live acceptance.

For native-to-Web switching after an opaque checkpoint, `web-history.cjs` reads
only bounded local rollout evidence for the exact task. It verifies the opaque
envelope, ordered retained-user boundary and supported history events before
expanding visible context. It does not decrypt or include private reasoning,
mutate the native request or substitute an unreadable-history note. Only an
engine-adjusted image `detail` hint may differ; image URL/bytes must match.
Missing history, rollback events and mismatches are explicit pre-browser errors.

## Browser and streaming lifecycle

Full mode attaches the exact `Codex++ Native v2` connector and proves the
composer pill before sending; the pill is selection evidence, not tool readiness.
The family list must actually be interactive (not merely mounted in hidden DOM),
and GPT-5.6 Sol must have `aria-checked=true`. Requested effort must fall within the live ARIA
slider range and must land on the exact value; it is never clamped. Unknown
model slugs are rejected.

Prompt insertion requires exact readback; partial insert fails without replaying
the whole prompt. Guarded rollback requires the same editor, URL, exact owned
prefix, uploaded image names and connector identity. Failed undo retains this
proof. Cleanup removes only owned images/pills, uses native editor keys, and
verifies the persisted upload draft after a completed reload before destroying
the owned window. Remounts, foreign edits or attachments are preserved and block
reuse until explicitly resolved; a destroyed window cannot retain a dead lease.
Submission is bound to observed user/assistant identities: an optimistic user
may already be present in the baseline, so a new assistant identity is also
acceptance evidence. Return or composer clearing alone does not prove acceptance.
Final completion requires the bound assistant identity, stable visible text,
no stop control, a completion action and the broker's tool-completion fence.
Partial text at a deadline is incomplete, never completed.

The SSE writer owns response/item/call ids and sequence numbers. It emits
`created` and `in_progress` immediately, parser-visible `response.heartbeat`
events while the browser or native tool is pending, commentary deltas, exact
tool boundaries and one terminal event. A normal tool boundary preserves the
browser lease and token. Cancellation, HTTP disconnect, browser close and hub
shutdown converge on the same abort path, and a new lease is not admitted until
the prior lease settles. An HTTP observer may reconnect during a five-second
grace window; exact accepted submissions and final responses use a bounded
in-memory journal. Tool-boundary retries return an explicit 409 uncertainty
error instead of replaying a potentially side-effecting native call. This is
not persistent idempotency across process restart. V1 JSON and V2 SSE compaction
use the same bounded request journal, separated by purpose/version: retries
preserve the original result or error instead of reopening the browser. Response
`end(body)` data is retained as well as streamed chunks.

Browser cancellation activates the visible Stop control with focus + Enter,
following the reference worker; it does not depend on a background pointer click.
If physical cleanup fails, capacity stays blocked with an explicit close-owned-
window recovery message. A native `interrupted` event alone is not proof that
the browser lease was released.

At most two task-owned browser leases may run concurrently. A third active owner
gets an explicit capacity error. An idle slot can be evicted only after physical
settlement; cancellation cannot release another task's slot. Full v2 subagents
are available only when the native catalog and actual turn registry advertise
them. Old v1-pinned threads are not silently upgraded. V2 collaboration
spawn/send/followup calls use the reference's `encrypted_function_args: []`
marker; incoming plaintext `agent_message` routing is validated and encrypted
variants are rejected. `wait_agent` requires exactly `timeout_ms=30000` so parent
waiting releases the shared MCP channel between polls. The installed Windows
build completed a live parent/child run with two distinct Web leases, native
receipts from both tasks and delivery of the child's result to the parent.
Shared-stdio delivery of a child result while a parent call remains pending is
also covered by a production-module offline test. This is bounded two-slot
support, not certification of arbitrary nesting or every scheduling race.

## Native tool bridge

The connector publishes a separate v2 identity (`codexpp-native-v2`, display
name `Codex++ Native v2`) and does not overwrite the older `Codex Native2`
connector. Refresh or create that connector explicitly after upgrading its
published action schema.

Its bounded MCP surface is:

- `codex_exec`
- `codex_write_stdin`
- `codex_apply_patch`
- `codex_view_image`
- `codex_tool_inventory`
- `codex_tool_call`

Server **2.1.0**, tool schema **revision 3**: all six actions require `turn_token`
and `request_id`. Each independent invocation (including an identical read or
wait poll) gets a new 8–128 character id using letters, digits, `_` or `-`.
Only an exact retry reuses that id. The native executor never receives these
transport fields. Live ChatGPT sent JSON-RPC `id=0` for separate calls in the
same process/session, so that id cannot provide idempotency. Reusing an explicit
id with changed arguments is a conflict, not a second execution. Missing ids
fail before native dispatch with an actions-refresh message.

Plaintext native agent updates accompanying tool results retain their separate
author/recipient roles in `_meta.codexpp_runtime_context` and a labeled content
block. Native receipt equality and error/content metadata remain unchanged.
Updates are bounded to 64 messages / 64 KiB. A new multimodal agent update in
this waiting-result path fails explicitly instead of being flattened to text.
After a verified browser final, only matching history/route plus late direct-
child notifications may replay that final. The in-memory receipt journal is
bounded to 16 entries / 8 MiB / five-minute validity and clears on shutdown;
it retains hashes and final text, not a token, browser, or full prompt. A new
instruction, unknown tool result, failure or cancellation cannot revive it.

Every operation goes back through the active Codex turn's advertised registry.
Direct function/custom tools are preferred, with their namespace and wire kind
preserved. The exec gateway is used only when actually advertised; its paged
inventory discovers `ALL_TOOLS` entries separately. That nested inventory only
provides names/descriptions in this engine, so freeform hints there are not a
complete typed nested registry. An absent native tool is an error; `apply_patch` is
not replaced with shell file writing. Function and freeform calls keep distinct
argument shapes. Rich results preserve `session_id`, `exit_code`, `isError`,
structured content, content blocks, image/resource data and metadata.
Native `input_image` data URLs are translated into MCP `image` blocks, not text;
image detail is preserved in metadata. HTTP(S) image URLs become resource links
without an implicit fetch. Invalid data URLs fail explicitly. The broker's
1 MiB frame bound still applies; large native image results are not certified.

Broker and MCP frames are bounded. EOF before newline fails. MCP negotiation
explicitly returns a supported version (currently up to `2025-06-18`) when a
client offers a newer version; it does not claim support for the offered version.
Malformed versions and unsupported methods fail. Standard `ping` returns `{}`
and proves only transport liveness; the launcher's nonce-bearing extension also
checks broker/schema/instance readiness. Tunnel readiness requires a health
endpoint plus MCP initialize, tools/list and an instance-bound nonce that also
round-trips through the broker. Stop cancels pending restarts.

The pinned tunnel-client 0.0.12 requires the routing channel `main`; the separate
connector identity remains `Codex++ Native v2` / `codexpp-native-v2`. Windows
stdio command arguments must escape backslashes for the client's shell-word
parser, not Windows CommandLineToArgvW. Readiness probes `/readyz`, not the health
server root or merely `/healthz`. Runtime setup and live evidence are recorded in
[the Windows setup checkpoint](chatgpt-web-live-20260910.md).

Live connector creation on 2026-09-10 offered `2025-11-25`. Rejecting that offer
caused HTTP 424; returning the supported version fixed creation and published
all six actions. This follows [MCP version negotiation](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#version-negotiation),
not a silent model or native-protocol fallback. When updating an existing v2
connector, refresh its actions in ChatGPT and verify the six names and input
schemas above; do not refresh/replace the unrelated `Codex Native2` connector.

## Engine wire measured on Windows (2026-09-11)

Measured with the installed `codex-cli 0.153.4`, using an isolated, empty,
auth-free temporary home and a loopback provider. No native tool is executed:

- requests are zstd JSON with `model`, `input`, `reasoning`, `stream`,
  `prompt_cache_key`, `text` and `client_metadata`;
- both `tools[]` and `input.additional_tools` namespace trees occur, depending
  on the actual model catalog and code-mode setting;
- the turn metadata supplies separate `thread_id`, `turn_id` and
  `context_window_id`;
- the engine replays cumulative prior tool outputs in later logical turns;
- a Web slug without its native startup catalog did not advertise `apply_patch`;
  passing `model_catalog_json` only per thread had no effect;
- with patch 119's engine-startup catalog, the same start/resume/fork matrix
  advertises native `apply_patch:custom`, exec, stdin, image and other direct
  tools. The exec/wait wire is also measured when explicitly requested;
- actual parser heartbeat test: 1500 ms silence with a configured 400 ms idle
  threshold completes; SSE comments alone fail at the same threshold. This is
  not a default-timeout live ChatGPT E2E test.

## Test layers

Offline CI, no account/browser/shell required:

```text
node tools/test-chatgpt-web-contracts.mjs
node tools/test-chatgpt-web-lifecycle.mjs
node --test tools/test-native-web-tools.mjs tools/test-web-turn-state.mjs tools/test-web-context.mjs tools/test-web-browser-contract.mjs tools/test-web-model-interaction.mjs tools/test-web-reconnect.mjs tools/test-web-routing.mjs tools/test-web-compaction.mjs tools/test-web-cancel.mjs tools/test-web-passthrough.mjs
```

The first covers prompt/identity/token/state/SSE/model/renderer contracts. The
second executes generated bridge programs against advertised-tool fixtures and
covers rich results, MCP/broker/tunnel readiness, compaction, EOF, capacity and
platform shortcuts.

Local engine contract, using the actual installed binary and a catalog cache
(not a valid login or copied auth). This is deterministic, not live GPT:

```powershell
$env:CODEX_BIN = "$env:LOCALAPPDATA\Programs\CodexPP\resources\codex.exe"
$env:CXP_WIRE_CATALOG_SOURCE = "$env:LOCALAPPDATA\CodexPP\codex-home\models_cache.json"
$env:CXP_WIRE_CATALOG_STARTUP = "1"
node tools/capture-web-engine-wire.mjs .build/web-engine-catalog-startup.json
$env:CXP_WIRE_COMPACT_MODE = "v1" # repeat with v2
node tools/capture-web-engine-wire.mjs .build/web-engine-compaction-v1.json
```

In a fresh shell, `CXP_WIRE_IDLE_MODE=heartbeat` enables the short-threshold
parser test; `comment` is its expected-failing negative control. Do not combine
compaction and idle modes. Temp-home cleanup failures are reported separately.
The older `test-chatgpt-web-engine.mjs` and harness E2E scripts are legacy
diagnostics with auth-copy/platform assumptions, not the current acceptance run.

Live browser/tunnel E2E additionally requires a signed-in ChatGPT Web partition,
a configured tunnel client/runtime key, and a refreshed `Codex++ Native v2`
connector. It must verify the picker, connector pill, tool receipt and temporary
workspace file effect across two messages in one native thread. Missing account,
connector or permission is `BLOCKED/NOT RUN`, never a mock pass.

## Runtime preflight and recovery

Full idle compaction now uses a separate, one-shot checkpoint capability through
the existing `codex_tool_call` action, with reserved wire name
`codex.control.compaction_handoff`. It is not an advertised work tool: it can
submit only its exact handoff summary and cannot claim the normal native
registry. The 5-minute transaction is bound to native thread/turn cancellation;
summary size is capped at 128 KiB. Ordinary assistant text cannot satisfy it.
Canonical matching reuses the existing connector/chat; otherwise the full
canonical context is sent with checkpoint-only authority. Output budget applies
to the actual outgoing prompt. The native epoch advances only after receipt and
physical browser settlement. Cancel/expiry/shutdown revoke the capability;
HTTP retries observe the original outcome. Active-tool handoff additionally
requires the exact source binding and all already-dispatched tool results;
missing results, an active HTTP owner, ambiguity or changed context fail closed.

DOM probes are limited to 10 seconds; the reader tolerates up to eight consecutive
probe timeouts within the unchanged turn deadline, resetting on successful
observation. This retries only a read, never browser submission or tool execution.
Missing/competing identities, navigation and terminal errors still fail closed.
A single proven assistant replacement may rebind within its accepted user turn.
Cancellation interrupts observation promptly, but a failed physical drain keeps
the lease occupied. Timeout diagnostics include only stage and structural health
fields, never prompt, token or private reasoning. These source guarantees do not
imply that every live DOM/crash variant has been tested; see the execution log.

Each native dispatch first observes its bound visible answer, so pre-tool
commentary cannot later masquerade as the post-tool final. An owned partial
composer insertion may be undone only while the same editor node still holds
that exact prefix of our transaction. User edits/remounts are preserved, never
cleared or appended to blindly. A live fault-injected partial insertion with one
image and one connector pill was cleaned before submission; the owned document
then closed and its lease settled. This does not certify arbitrary foreign edits.

Image uploads validate the entire batch: PNG/JPEG/GIF/WebP MIME for data URLs,
canonical nonempty base64, at most 10 images, 20 MB per image and 50 MB total
(decimal bytes). Local paths require an allowed extension and a bounded regular
file; this is not a full codec validator. Tiles and enabled Send must acknowledge
all files before prompt submission. No oversized attachment is silently dropped.

Renderer loss aborts only the owning lease and destroys its dead window. It does
not reload or resubmit the accepted prompt. Late events from an old owner cannot
invalidate its successor. Native turn cancellation preserves the installed
engine's semantics: cancelling `write_stdin` is not a guarantee that an already
running shell process has been killed. Use the same native session to inspect or
interrupt it; the hub never adds an unrestricted process-killing executor.

Switching back to native Codex expands only bridge-owned `ocx1:` checkpoints
to ordinary summary-prefix messages, preserving inline history, images and
`call_id` evidence. Backend-local item IDs are removed at that proven boundary.
Opaque native checkpoints and ordinary native requests remain untouched. Incomplete
provider-local history references are rejected, not silently discarded.
Rich MCP replies still have a 1 MiB frame cap: exceeding it returns a bounded
error warning that execution may have completed and must not be retried. This
build does not claim support for arbitrary-size native image/resource results.

| Error / condition | Meaning and next action |
|---|---|
| Gateway/catalog not ready | Wait for startup; inspect catalog error and installed engine arguments. Restart after catalog changes; do not globally reroute config. |
| Unknown Web slug / remote Web host | Unsupported selection; no current-model or local-loopback fallback. |
| Missing thread/turn identity, encrypted input, previous_response_id | Unsupported or incomplete native contract; reject before browser submission. |
| Connector unavailable in Temporary Chat | No task sent. User must review privacy/connector availability; never silently save to normal history. |
| Family/effort cannot be proved | No task sent. Refresh live account capability and visible picker; do not clamp Pro. |
| Prompt/attachment limit | Explicit rejection; nothing is silently shortened. Token estimates, characters, bytes and attachment limits are distinct. |
| Expired/ambiguous call or tool-boundary retry | Do not automatically run the action again; inspect native receipt and effect first. |
| Capacity occupied / drain blocked | Both task slots are occupied, or an owner's physical drain failed. Cancel/drain or close only that owned window; never replace its lease early. |
| Structured checkpoint handoff missing / expired | No checkpoint accepted; ordinary response text cannot replace the receipt. Inspect the existing connector's action result; never resubmit an accepted operation automatically. |
| DOM observation timed out | Scoped reader probe failed; the bounded read-only retries were exhausted or a preparation probe failed. Inspect the named phase and owned browser; increasing turn timeouts does not prove recovery. |
| Browser renderer stopped | The owned renderer was lost and destroyed; the turn fails without automatic replay. Verify any already dispatched native side effects before starting a new logical turn. |
| Partial prompt / existing draft | No Send or character replay. Exact owned insertions and uploads are transactionally cleaned; foreign edits/remounts are preserved for explicit review. Failed physical cleanup keeps the slot blocked. |
| Active compaction source/result mismatch | The source is not at a verified tool boundary or lacks canonical results. Do not replay tools; inspect the exact task receipt. |
| Unsupported encrypted/subagent protocol | Use only the engine-advertised v2 plaintext contract. An old task's v1 pin is not silently rewritten; unavailable tools are not guessed. |
| Native tool timeout / stale late result | The binding is retired, queued calls cannot run, and dispatched side effects may be uncertain. Inspect native receipts before an explicit new turn; never retry automatically. |
| Missing request_id / schema revision 3 required | The published connector actions are stale. Refresh only Codex++ Native v2; no native tool was executed. Each new invocation needs a fresh id. |

Connector migration: keep the reference `Codex Native2` untouched. Use the
existing approved `Codex++ Native v2` tunnel/runtime key. Refresh **that**
connector's published actions after a schema update, verify all six names AND
input schemas, then run a harmless nonce and inventory roundtrip for the right
instance and logical turn. Local `/readyz`, initialize/tools/list and broker
nonce tests do not prove that ChatGPT has refreshed its cached action schema.
Never print keys or grant additional persistent scopes to troubleshoot it.

Verified migration path (2026-09-11): ChatGPT **Eklentiler → Codex++ Native v2 →
Eklenti işlemleri → Yönet → Bilgi → Yenile**. The existing application id ends
in `b0755fcc`; `Codex Native2` is a different application and was not modified.
All six published schemas were read back and required `request_id`. The plugin
page's `1.0.0` label is not the MCP server version or proof of action freshness.

Installation, exact executed commands, failures/skips, live evidence and rollback
are recorded in [the execution log](chatgpt-web-execution-20260911.md). The current
build has live evidence for native patch/file effects across multiple messages,
exec/session/stdin, retained-chat fresh tokens, an advertised app tool, image
input/return, owned rollback, cancellation/crash recovery, opaque-history
native-to-Web recovery, active-tool compaction, parent/child, fork/high effort and
restart/resume. The precise late-child-after-final race has an offline regression,
not a separately forced live reproduction after the fix. Remote-host E2E,
account-switch/other-account Temporary Chat matrices and macOS live signature/
Computer Use checks were not run. Windows tests do not certify those platforms.

## Reference and license

The implementation adapts relevant contracts from the source of
`miuuyy/codex-chatgpt-web` at commit
`e85e3693fdb4e3e033348c08df0298c20fcdb612`; it does not copy that repository's
launcher wholesale. The MIT notice is retained in `THIRD_PARTY_NOTICES.md`.
