# Smoke Test Procedure

This document provides a step-by-step verification procedure for validating Codex++ builds, following the rules established in [AGENTS.md](../AGENTS.md).

## Verification Steps

1. **Apply the Patch / Build the Bundle**:
   - Run the platform installer or apply patches directly to ensure syntax and anchor resolution succeed:
     ```bash
     ./install/mac/install.sh install
     ```
   - Confirm all eight patches apply with 0 errors and unique anchor matches.

2. **Launch via Application Binary with Remote Debugging Port**:
   - Launch the binary directly (do not rely on `open -a` which might ignore `--args` if an instance is active):
     ```bash
     /Applications/Codex++.app/Contents/MacOS/Codex++ --remote-debugging-port=9222
     ```
   - **Port Binding**: The debugging port may bind to IPv4 (`127.0.0.1:9222`) or IPv6 (`[::1]:9222`). Try both addresses when connecting.
   - **Stale Lock Cleanup**: If the application outputs `Opening in existing browser session.` and exits immediately, remove the stale lock file if its PID is not running:
     ```bash
     rm -f "$HOME/Library/Application Support/CodexPP/SingletonLock"
     ```

3. **Open Menu over CDP**:
   - Connect to the DevTools target via Chrome DevTools Protocol (CDP).
   - Dispatch real input events (`Input.dispatchMouseEvent` with `mousePressed` / `mouseReleased`) targeting the profile menu trigger in the sidebar footer.
   - *Note*: Synthetic `.click()` in JavaScript does not trigger React handlers, and Radix UI menu items select on `pointerup`.

4. **Read Real DOM Text**:
   - Inspect the DOM elements over CDP to confirm:
     - Multi-account list items are present with labels, plans, and usage.
     - Total remaining headroom displays accurately.
     - "Add another subscription" and logout action buttons are rendered.

5. **Capture a Screenshot**:
   - Take a screenshot via CDP (`Page.captureScreenshot`) to visually verify layout, colors, and styling without regressions.

6. **Wait and Re-Inspect**:
   - Wait 10–15 seconds and re-check the DOM and authentication status. Some auth failures or token rejection loops occur asynchronously after startup.

## Monitoring App Stdout Logs for Auth Regressions

Always review stdout/stderr output from the app process. Look specifically for these error signatures:

- `desktop_fetch_auth_401`: Indicates backend request returned 401 Unauthorized; token refresh is required.
- `account_info_token_unavailable`: Indicates the main process could not find a bearer token for the current account.
- `auth_status_result`: Reports whether `authenticatedAccountPresent` is `true` or `false`. If `false`, the UI will fall back to the sign-in screen.

If these signatures appear, check patch 070 (renderer `authMode` normalization) and patch 080 (main process token attachment).
