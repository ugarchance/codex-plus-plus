# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **macOS build 26.818.41509 (6962) compatibility**: three patches no longer matched the refreshed renderer bundle and are re-anchored on meaning rather than on compiler output.
  - `070-auth-mode`: upstream merged the two `getAuthMethod` client classes into one, so the patch now accepts one or two definitions instead of exactly two.
  - `090-auto-routing-core`: the `thread/started` and `thread/unarchived` handlers moved from class methods to free functions (`this` became a parameter); the literal anchors are now regexes that capture the minified receiver and rewrite it back.
  - `111-profile-stats`: the React Compiler moved the profile header props from the parameter list into the body, and the avatar container left its `Fragment`; the patch now anchors on the props signature and swaps the avatar container alone.
  - `091-rate-limit-failover`: the banner anchor depended on React Compiler memo slot numbers (`t[137]`, `c(18)`), which move on every build. It is now located through the `codex.upsellBanner.plus.headline.noReset` i18n id and a bounded window around it.
- Registered build 26.818.41509 (6962) in `patch/compatibility.json`.

### Changed

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
