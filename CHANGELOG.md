# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
