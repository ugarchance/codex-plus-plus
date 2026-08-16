# Security Policy

## Data Storage & File Paths

Codex++ operates locally on your machine and divides its state between two directories:

1. **Shared Engine State (`CODEX_HOME` / `~/.codex`)**:
   - Contains conversation history, project settings, and skills shared with the stock Codex app.
   - The native account's `auth.json` is read live from `~/.codex/auth.json`. Codex++ never moves or alters `auth.json` during normal account switching. When signing out of the native account, `auth.json` is archived to a timestamped backup under `USER_DATA_DIR` rather than permanently deleted.

2. **Isolated User Data Directory (`USER_DATA_DIR`)**:
   - **macOS**: `~/Library/Application Support/CodexPP`
   - **Windows**: `%LOCALAPPDATA%\CodexPP`
   - Keeps secondary account tokens (`accounts.json`), app cache, and timestamped backups (`backups/`).
   - Maintaining a separate user data directory prevents lock contention on Electron's single-instance locks (`SingletonLock`).

## Token Handling & Privacy

- **No Token Logging**: Access tokens, refresh tokens, and session keys are **never** logged to stdout, stderr, or log files. Only sanitized identifiers, token hashes, expiration timestamps, or boolean availability flags are logged for debugging.
- **Restricted File Permissions**: On POSIX systems, `accounts.json` and any temporary token files are written with `0600` permissions (`-rw-------`), restricting read/write access exclusively to the current user.
- **In-Memory Switching**: Account switching uses the engine's in-memory `chatgptAuthTokens` authentication mode, avoiding disk writes to `~/.codex/auth.json` during runtime operation.

## Code Signing & Platform Integrity

- **macOS Ad-hoc Signature**:
  - The patched bundle is signed locally using an ad-hoc signature (`codesign --sign -`).
  - Restricted Apple entitlements (`keychain-access-groups`, `application-groups`, `aps-environment`, `application-identifier`) bound to OpenAI's developer team ID are stripped because they cannot be transferred to local builds.
  - As a result, Apple notarization is invalidated and push notifications / certain sandbox IPC capabilities are disabled.
  - **Codex++ is designed for local, single-user use and is not intended for external binary distribution.**
- **Windows**:
  - The copied app binaries retain their original Authenticode signatures and run without requiring elevated package identity.

## Reporting a Security Vulnerability

If you discover a security vulnerability or potential credential leak in Codex++, please do not open a public issue. Instead, report it responsibly to the project maintainers via private communication or GitHub Security Advisories.
