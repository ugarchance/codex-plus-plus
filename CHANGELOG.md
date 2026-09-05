# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Claude Code sessions as native Codex tools** (`integrations/claude-peers/`): an MCP stdio server that lets Codex list the Claude Code sessions running on the machine, message them, and read their replies — `mcp__claude_peers__list_claude_sessions`, `send_message_to_claude`, `read_claude_messages`, `claude_peer_address`. No relay session: the server speaks Claude's peer socket directly. It also registers itself in `~/.claude/sessions/`, so the traffic is bidirectional — Claude's own `ListAgents` shows Codex as a peer named `codex` and `SendMessage` reaches it. Both installers register it automatically (`SKIP_CLAUDE_PEERS=1` on macOS, `-SkipClaudePeers` on Windows) and the uninstallers remove it. Node only, no dependencies; Windows uses a named pipe instead of a Unix socket.

  The wire format was measured against a live session rather than guessed, and three behaviours are load-bearing: the sender does not send an auth frame (requiring one drops the connection with `ECONNRESET`), the receiver must not write a reply (an `ack` the sender never reads produces `read ECONNRESET` on its side), and every message is preceded by a liveness probe that connects and closes without sending.
- **Inline provider settings on Windows 26.901**: compact connections/model editor below Analytics, multiple API keys per provider, selectable model efforts, ChatGPT account selection and Go quota reporting. Dynamic MIT-licensed codex-router catalog with a data-only refresh; private encrypted keys and per-thread loopback routing. Responses, Chat Completions and Messages adapters preserve tool calls and encrypted reasoning history. Unsupported connection/profile types are explicitly disabled.
- Provider regression tests cover key isolation, three connections, pinned routing, quota/auth failures, SSE fragmentation, tools and reasoning round trips. OpenCode Go was validated with a user-configured key across all three protocols, namespace tool round trips, quota reads and a completed Desktop message.

### Fixed

- **macOS build 26.825.51511 (7377) compatibility**: `090-auto-routing-core` no longer matched the refreshed renderer bundle. Its `thread/unarchived` direct-handler pattern hardcoded the minified branding helper `Il(`, which upstream renamed to `Mm(`. The wrapper is now an optional non-capturing group over the generic identifier pattern and the params receiver is captured and written back, so the anchor rests on the `thread/unarchived` protocol constant and the `.params.threadId` access instead of on a minified name. The other thirteen patches applied unchanged.
- Registered build 26.825.51511 (7377) in `patch/compatibility.json` and recorded the previously missing Windows `26.820.71523` row in `docs/COMPATIBILITY.md`.
- **Quota refresh across multiple subscriptions**: an expired/revoked account no longer stops valid accounts from refreshing. Failed accounts show an explicit sign-in/usage error instead of an old percentage; successful reads clear the error. Reproduced and fixed the gptugar 57% display from an August 23 cache while the live account reported a different weekly quota.
- **Provider model scrolling**: bound the inline Settings panel to its available height and give long model lists their own scroll area. Verified wheel scrolling with 35 Go models.
- **External Desktop messages**: translate namespaced function/custom tools for Chat/Messages, including response identities and history. Disable unsupported OpenAI-hosted web search for those thread protocols.
- **Windows 26.901.5280.0 / Astra compatibility**: ported account menus, reset-credit UI and quota banners to the split renderer bundles; adapted auth-refresh responses, thread notifications and profile props. The native external-auth token gates are verified instead of patched twice. Quota error handling and its banner now use separate patches (091/092).
- **Windows startup after repacking**: update the copied executable's ASAR integrity resource to match the patched header. The installer now installs locked dependencies on updates. Added protocol and PE integrity regression tests.

- **Failover card never offered a switch**: `_cxpFailoverCard` asked the hub for a suggestion with no exclusion list, so the best candidate was almost always the account already active; the `Switch to <account>` action was therefore never rendered and the card fell back to "No eligible account available". The card now excludes the active account from the request, writes a null result back to state, and re-queries when the active account changes. `isExcluded` in `hub/routing.cjs` also accepts a plain account id string, which previously fell through to "not excluded".

- **macOS build 26.818.41509 (6962) compatibility**: three patches no longer matched the refreshed renderer bundle and are re-anchored on meaning rather than on compiler output.
  - `070-auth-mode`: upstream merged the two `getAuthMethod` client classes into one, so the patch now accepts one or two definitions instead of exactly two.
  - `090-auto-routing-core`: the `thread/started` and `thread/unarchived` handlers moved from class methods to free functions (`this` became a parameter); the literal anchors are now regexes that capture the minified receiver and rewrite it back.
  - `111-profile-stats`: the React Compiler moved the profile header props from the parameter list into the body, and the avatar container left its `Fragment`; the patch now anchors on the props signature and swaps the avatar container alone.
  - `091-rate-limit-failover`: the banner anchor depended on React Compiler memo slot numbers (`t[137]`, `c(18)`), which move on every build. It is now located through the `codex.upsellBanner.plus.headline.noReset` i18n id and a bounded window around it.
- Registered build 26.818.41509 (6962) in `patch/compatibility.json`.

### Changed

- **macOS installer parity with Windows**: `install/mac/install.sh` now forwards `--allow-untested-source` when `ALLOW_UNTESTED_SOURCE` is set, matching the Windows installer's `-AllowUntestedSource` switch. Qualifying a fresh upstream build on macOS no longer requires invoking `patch/apply.mjs` by hand.

- **Weighted pool capacity calculation**: Replaced unweighted sum and simple averages with plan-capacity-weighted calculations across connected accounts. Subscriptions are weighted proportionally according to official tier capacity ratios (Pro at 200x, Pro Lite at 50x, Plus/Team/Enterprise/Business/Edu at 10x, Free/Go at 1x baseline).
- Added `hub/weights.cjs` as single source of truth for plan weights.
- Extended `hub/probe.cjs` and `hub/store.cjs` `publicView()` to supply `planWeight` and `windowMins`.
- Updated profile menu (`040-account-menu`) and failover banner (`091-rate-limit-failover`) to calculate weighted remaining headroom.

### Added

- Multi-account support for ChatGPT subscriptions in the Codex desktop app.
- Platform installers for macOS (`install/mac/install.sh`) and Windows (`install/windows/install.ps1`).
- Non-destructive installer backup flow: previous installations are archived under `USER_DATA_DIR/backups/` instead of being deleted.
- Eight targeted binary/bundle patches (010–080):
  - `010-external-auth-refresh`: Answers the engine's token refresh requests for external host authentication (`chatgptAuthTokens`).
  - `020-hub-bootstrap`: Starts the hub side-process on startup and disables the in-app updater (`CODEX_SPARKLE_ENABLED=false`).
  - `030-preload-bridge`: Exposes the `__codexpp` context bridge to the renderer.
  - `040-account-menu`: Injects the multi-account profile menu (account switcher, per-account usage, total headroom, logout, and add subscription).
  - `050-user-data-dir`: Skips late `setPath('userData')` calls on macOS to prevent TCC permission prompts.
  - `060-app-server-client`: Registers the app-server client and restores the preferred active account on startup.
  - `070-auth-mode`: Normalizes host-supplied authentication mode (`chatgptAuthTokens`) in the renderer UI.
  - `080-main-auth-token`: Attaches bearer authentication tokens in the Electron main process for external auth sessions.
- Profile menu UI features:
  - Combined headroom / remaining usage indicator across connected accounts.
  - Per-account rows with avatar, label, plan type, and remaining quota.
  - Seamless in-app switching without dropping sessions or resetting history.
  - Single-account sign out without logging out of remaining accounts.
  - Add subscription flow via in-app browser or CLI tool (`tools/add-account.mjs`).
- Hub architecture (`hub/`):
  - Local side-process running inside the app package.
  - Shared thread history, projects, and skills via `~/.codex` (`CODEX_HOME`).
  - Isolated user data and account credentials stored securely under `USER_DATA_DIR` (`accounts.json` with 0600 permissions).
  - Multi-account rate limit and usage fetching via short-lived `codex app-server` instances.
