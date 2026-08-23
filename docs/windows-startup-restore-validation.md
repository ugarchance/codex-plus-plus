# Windows Startup Restore Validation

Validated on 2026-08-23 from the `main` branch on Windows.

## 1. Scope

The change makes startup account restoration run even when the persisted active
account already equals the preferred account. The first `account/read` request
waits for that restoration, preventing the fresh app-server from reporting a
signed-out state before the saved credentials are reapplied.

Files under direct test:

- `patch/patches/060-app-server-client.mjs`
- `tools/analyze-main-auth.mjs`
- `tools/cdp-inspect.mjs`
- `tools/test-app-server-restore.mjs`

## 2. Source Identification

- Windows Store package: `OpenAI.Codex_26.818.5229.0_x64`
- Internal Electron app version: `26.818.41509`
- Stock `app.asar` SHA-256:
  `c5d839bc9b122b7ef2a2f0f45186b3e5895923de5b6cef5253c936fe670c0479`
- The running CodexPP `app.asar` matched the validation build byte-for-byte:
  `c2ae1aa34a12f48a1ad540abb9819d0986f871763ee78edb04368b2180eb1d3d`
- All 13 tracked hub files matched the running installation.

## 3. Static and Regression Tests

- `node --check` passed for all four files in scope.
- `node tools/test-app-server-restore.mjs` passed. It proved that:
  - restore runs when persisted active and preferred accounts are already equal;
  - `account/login/start` completes before startup `account/read`;
  - the first restore attempt does not wait on a timer.
- Pool statistics: 56/56 passed.
- Profile merge, resets, and plan weights passed; plan weights were 29/29.
- Routing: 40/41 passed on Windows. The only mismatch is the existing test that
  expects POSIX mode `0600`; Node reports `0666` on Windows even though the
  product source writes with `{ mode: 0o600 }`. All functional routing checks
  passed.

## 4. Real Windows Bundle

All 14 patches applied to the stock Windows `app.asar` with exactly one selected
target per patch. Acorn parsed every modified JavaScript file successfully, and
the patched archive was repacked without errors.

The AST analysis tool found exactly one enclosing function for each semantic
anchor:

- `does not match AppServerManager hostId`: 1 hit
- `account/read`: 1 hit

The formatted output confirmed that the local AppServerManager registers itself,
starts restoration, and that `getAccount` awaits `__cxpRestorePromise` before it
sends `account/read`.

## 5. Live Restart Verification

Before restart, CDP showed two connected subscriptions, a registered `local`
client, and the persisted active account equal to the preferred account. This is
the exact state that previously skipped restoration.

After restarting only CodexPP:

- CDP became ready normally.
- Both subscriptions remained present.
- Active and preferred accounts still matched.
- `__cxpRestorePromise` existed and the `local` client was registered.
- The application remained on the signed-in workspace rather than falling back
  to the sign-in screen.
- A real CDP mouse gesture opened the profile menu.
- Account plan rows, weighted remaining usage, automatic routing, add-account,
  and sign-out controls were visible in the rendered menu.
- A screenshot was captured and inspected locally; it is not committed because
  it contains account-identifying UI.

The same checks were repeated after 15 seconds. Counts remained stable, and the
captured stderr log contained zero instances of:

- `desktop_fetch_auth_401`
- `account_info_token_unavailable`
- `authenticatedAccountPresent=false`
- syntax errors
- unhandled promise rejections
- fatal errors

## 6. State Safety

`~/.codex/auth.json` and the CodexPP account store were backed up before restart.
Authentication data did not change. Startup refreshed only `usageAt` and
`usedPercent` fields; the original account store was restored and its SHA-256 was
verified before the final live CDP check.

## Conclusion

The startup restore change and its diagnostic tools work against the current
Windows Store build. The build is safe to add to the compatibility manifest.
