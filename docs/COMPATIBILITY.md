# Compatibility Gate

Codex++ patches official ChatGPT / Codex desktop applications. To avoid applying patches against untested or incompatible upstream builds, the patch installer verifies the source `app.asar` SHA-256 hash against a whitelist of verified builds in [`patch/compatibility.json`](../patch/compatibility.json).

## Tested Builds

| Platform | ChatGPT Version | Build | app.asar SHA-256 | Tested At | Notes |
|---|---|---|---|---|---|
| macOS (`darwin`) | `26.810.52044` | `6662` | `6e7e8791b8bf69a586ff994721fff518af391d9efdc66cd2e620dd2a4aedc90f` | 2026-08-16 | macOS official release |
| macOS (`darwin`) | `26.818.41509` | `6962` | `8eb91bd9efbf9a4dd04b9b0afdbfcb4e0bab5da18c1919ad74ca327c00c7e791` | 2026-08-23 | macOS official release |
| Windows (`win32`) | `26.818.41509` | `26.818.5229.0` | `c5d839bc9b122b7ef2a2f0f45186b3e5895923de5b6cef5253c936fe670c0479` | 2026-08-23 | Windows Store package; internal Electron app version shown in the version column |
| Windows (`win32`) | `26.820.71523` | `26.820.9563.0` | `e353c580ef4939d36f4ae32a35c896d089205c1d06b9f711cf78ffa4a3578a8a` | 2026-08-27 | Windows Store package; local CDP smoke passed |
| macOS (`darwin`) | `26.825.51511` | `7377` | `f56ac8d5254a10fc4a04e7417fa787d135c3bbca49bad7d668d4ae65833d40c7` | 2026-08-30 | macOS official release; live CDP smoke passed (account menu, cards/bars usage view, account switch) |
| Windows (`win32`) | `26.901.41600` | `26.901.5280.0` | `6579c4326cccdb508d079ecc878ad4725451b2234370d2ed9d4db53939cf99c7` | 2026-09-05 | Astra, account/reset UI, inline providers, model selection, scrolling, live Go tools and quota refresh verified; see [evidence and limits](provider-tools-and-usage-0905.md) |

## Rules

1. **Gate Enforcement:**
   `patch/apply.mjs` calculates the SHA-256 hash of the source `app.asar` and checks it against `testedBuilds` in `patch/compatibility.json`.

2. **Rejection of Unknown Builds:**
   Any unknown or unverified official build is rejected immediately with an error (exit code 1) and marked as untested.

3. **Diagnostic Override (`--allow-untested-source`):**
   The `--allow-untested-source` flag serves as a diagnostic / development override. When specified, a warning is printed and patching proceeds despite the untested source hash.

4. **Verification Without Patching (`--check-only`):**
   `node patch/apply.mjs --check-only --src <path-to-app.asar>` verifies whether the specified source `app.asar` matches a known tested build without extracting or modifying any files.

5. **Installer Override:**
   Both installers pass the override through when asked: `ALLOW_UNTESTED_SOURCE=1 install/mac/install.sh install` on macOS, `-AllowUntestedSource` on Windows. Use it to qualify a fresh upstream build, then record the verified hash here and in `patch/compatibility.json`.
