# Codex++

Multiple ChatGPT subscriptions in one Codex desktop app.

Codex++ installs a second app next to the original — on macOS next to
`ChatGPT.app`, on Windows as a per-user copy of the store-installed Codex app —
without touching the original. Every subscription you connect shows up in the
profile menu with its own avatar, plan and remaining usage. Click a row to
switch the whole app to that account — history, projects and skills stay
shared.

![Account menu](docs/account-menu.png)

The original app is left exactly as it is. You can go back to it whenever you
want.

## Install

macOS:

```bash
./install/mac/install.sh install
```

Requirements: macOS, Xcode Command Line Tools (`clang`), an installed
`ChatGPT.app`.

Windows (the Codex desktop app from the Microsoft Store):

```powershell
powershell -ExecutionPolicy Bypass -File install\windows\install.ps1
```

Requirements: Windows 10/11, Node.js, the store-installed `OpenAI.Codex`
package. The installer finds the package, copies its payload to
`%LOCALAPPDATA%\Programs\CodexPP`, patches it and creates Start Menu /
Desktop shortcuts. No compiler is needed — the shortcut passes
`--user-data-dir` directly, which on macOS is the launcher's job.

Uninstall:

```bash
./install/mac/install.sh uninstall          # macOS
powershell -ExecutionPolicy Bypass -File install\windows\uninstall.ps1   # Windows
```

## Using multiple accounts

Open the profile menu in the sidebar footer:

- **Usage remaining** — the combined headroom across every connected
  subscription, shown when you have more than one.
- **Account rows** — avatar, label, plan and that account's own remaining
  usage. A check marks the account the engine is currently using. Click a row
  to switch to it.
- **Log out icon** — signs out of that single account. If it was the active
  one, the app keeps running on the next remaining account instead of dropping
  you at the sign-in screen.
- **Add another subscription** — opens the ChatGPT login flow and stores the
  new account.

You can also add an account from the terminal:

```bash
node tools/add-account.mjs "Work"
```

The account you pick is remembered and restored the next time the app starts.

## Configuration

macOS (environment variables for `install.sh`):

| Variable | Default |
|---|---|
| `SRC_APP` | `/Applications/ChatGPT.app` |
| `DEST_APP` | `/Applications/Codex++.app` |
| `BUNDLE_ID` | `com.local.codexpp` |
| `USER_DATA_DIR` | `~/Library/Application Support/CodexPP` |
| `CODEX_HOME_SHARED` | `~/.codex` |

Windows (parameters for `install.ps1`):

| Parameter | Default |
|---|---|
| `-SrcApp` | auto-detected from the `OpenAI.Codex` store package |
| `-DestDir` | `%LOCALAPPDATA%\Programs\CodexPP` |
| `-DataDir` | `%LOCALAPPDATA%\CodexPP` |

`CODEX_HOME` is deliberately **shared** with the original app so thread
history, projects and skills carry over. The user data dir is separate —
without it the two apps collide on Electron's single-instance lock.

## How it works

The app is Electron (`app.asar`); the engine is a separate `codex app-server`
process and the two speak JSON-RPC. The same eight patches apply on both
platforms — only the packaging around them differs.

Installing on macOS does this:

1. Copy the bundle with `ditto`
2. Rewrite `CFBundleIdentifier`, `CFBundleName`, `CFBundleExecutable`
3. Compile `install/mac/launcher.c` and make it the main executable
4. Drop `embedded.provisionprofile` and the old signature
5. Ad-hoc sign inside out

Installing on Windows does this:

1. Copy the MSIX payload (`app\`, entry point `ChatGPT.exe`) to `DestDir`
2. Patch `resources\app.asar` and drop `resources\hub` in place
3. Create shortcuts that pass `--user-data-dir=<DataDir>` to `ChatGPT.exe`

No plist, launcher or re-signing is needed on Windows: the store package is
read-only, but the copy is not, and a shortcut can carry command-line
arguments. The copy also never receives store updates — re-run the installer
after the original app updates to refresh it.

### Account switching

The engine supports an auth mode where the host app supplies ChatGPT tokens
instead of managing them itself (`chatgptAuthTokens`). The stock desktop app
never uses it — it only ever sends `{type:"chatgpt"}` and lets the engine read
`~/.codex/auth.json`. That single file is why the stock app has exactly one
account, and why logging out signs you out of everything.

Codex++ takes over that channel:

- A side process (`hub/`) keeps a store of accounts and their refresh tokens
  under `USER_DATA_DIR`, and mints access tokens on demand.
- The account in `~/.codex/auth.json` is read live as the *native* account, so
  the account you already signed in with shows up without being copied
  anywhere.
- Picking an account sends `account/login/start {type:"chatgptAuthTokens"}` to
  the engine. The switch is immediate, needs no logout, and never writes to
  `~/.codex/auth.json`.
- When the engine hits a 401 it asks the host to refresh; the hub answers with
  a fresh token for the account currently in use.

Per-account usage comes from the engine too, not from a web endpoint: the hub
spawns a short-lived `codex app-server` in a temporary `CODEX_HOME`, logs into
each account in turn with its own token, and reads
`account/rateLimits/read`.

### Why a launcher is needed on macOS

The `userData` directory can only be changed through Chromium's
`--user-data-dir` switch. The `CODEX_ELECTRON_USER_DATA_PATH` variable in the
code is read but has no effect:

```
ERROR:owl/browser/api/electron_api_app.cc:792
Ignoring late userData path change after native startup.
```

`app.setPath('userData')` is called after native startup, so OpenAI's Electron
fork refuses it. Since arguments cannot be put in `Info.plist`, and the
hardened runtime will not accept a shell script as the main executable
(`Launchd job spawn failed`, POSIX 162), a small Mach-O launcher is required.

On Windows none of this applies: the shortcut points at the copy's
`ChatGPT.exe` and carries `--user-data-dir` itself.

### Signing (macOS)

Ad-hoc signature. Restricted entitlements (`keychain-access-groups`,
`application-groups`, `aps-environment`, `application-identifier`) are dropped —
they are bound to OpenAI's team id and cannot be transferred. What is lost:
push notifications and two app-group services.

`Codex++-bin` must be signed with entitlements, otherwise library validation
refuses to load `Codex Framework` (*different Team IDs*).

Nothing is re-signed on Windows: the copied executables keep OpenAI's
authenticode signatures and need no entitlements.

### Auto-update

Patch 020 sets `CODEX_SPARKLE_ENABLED=false` in the main process on every
platform. That one flag gates all three updaters — Sparkle on macOS, the
Microsoft Store updater and the MSIX fallback on Windows. On Windows the flag
matters even more than on macOS: the copy runs without MSIX package identity,
so the store updater would throw `İşlemde paket kimliği yok` on every launch
and the copy could never update itself anyway. On both platforms: re-run the
installer after the original app updates.

## Patches

The patched surface is kept small — everything else lives in `hub/` as ordinary
code.

| # | File | Job |
|---|---|---|
| 010 | `webview/assets/app-initial-*.js` | answer the engine's token refresh request |
| 020 | `.vite/build/early-bootstrap.js` | start the hub in the main process and set `CODEX_SPARKLE_ENABLED=false` |
| 030 | `.vite/build/preload.js` | expose the `__codexpp` bridge to the renderer |
| 040 | `webview/assets/app-initial-*.js` | account list, usage, switching and logout in the profile menu |
| 050 | `.vite/build/bootstrap-*.js` | skip the `setPath('userData')` call that triggers a macOS permission prompt |
| 060 | `webview/assets/app-initial-*.js` | register the app-server client and restore the preferred account |
| 070 | `webview/assets/app-initial-*.js` | treat host-supplied auth as a normal ChatGPT session in the UI |
| 080 | `.vite/build/src-*.js` | let the main process attach the auth token in that mode |

Patches are anchored on meaning — protocol constants, React keys, prop
signatures — never on minified names, and each anchor must match exactly once.
See [AGENTS.md](AGENTS.md) for the method.

To regenerate the protocol schema (macOS):

```bash
/Applications/ChatGPT.app/Contents/Resources/codex app-server generate-json-schema --out ./schema --experimental
```

On Windows the engine is `%LOCALAPPDATA%\Programs\CodexPP\resources\codex.exe`.

## Caveats

- Do **not** run the fork and the original at the same time. A shared
  `CODEX_HOME` means two app-servers hitting the same SQLite files.
- On macOS an ad-hoc signature invalidates notarization. This is for local use
  only, not for distribution.
- The `chatgptAuthTokens` auth mode is marked unstable in the protocol schema.
  If a future release changes it, the symptom is `account/login/start`
  returning an error.
- Logging out of the native account moves `~/.codex/auth.json` to a timestamped
  backup under `USER_DATA_DIR` rather than deleting it.
