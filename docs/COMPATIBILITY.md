# Compatibility Gate

Codex++ patches official ChatGPT / Codex desktop applications. To avoid applying patches against untested or incompatible upstream builds, the patch installer verifies the source `app.asar` SHA-256 hash against a whitelist of verified builds in [`patch/compatibility.json`](../patch/compatibility.json).

## Tested Builds

| Platform | ChatGPT Version | Build | app.asar SHA-256 | Tested At | Notes |
|---|---|---|---|---|---|
| macOS (`darwin`) | `26.810.52044` | `6662` | `6e7e8791b8bf69a586ff994721fff518af391d9efdc66cd2e620dd2a4aedc90f` | 2026-08-16 | macOS official release |

> **Windows:** There is no tested Windows build entry yet. Windows versions will be added to the list as they are tested.

## Rules

1. **Gate Enforcement:**
   `patch/apply.mjs` calculates the SHA-256 hash of the source `app.asar` and checks it against `testedBuilds` in `patch/compatibility.json`.

2. **Rejection of Unknown Builds:**
   Any unknown or unverified official build is rejected immediately with an error (exit code 1) and marked as untested.

3. **Diagnostic Override (`--allow-untested-source`):**
   The `--allow-untested-source` flag serves as a diagnostic / development override. When specified, a warning is printed and patching proceeds despite the untested source hash.

4. **Verification Without Patching (`--check-only`):**
   `node patch/apply.mjs --check-only --src <path-to-app.asar>` verifies whether the specified source `app.asar` matches a known tested build without extracting or modifying any files.
