# Provider routing, effort and CLI isolation validation

## Scope

Reproduce the unsupported ChatGPT-account error for
`cxp/opencode-go/muse-spark-1.3-contributor`, validate every supported effort on
at least ten external models, inspect both model-picker layouts including the
effort slider, and prevent Codex++ selections from changing local Codex CLI state.

## Investigation log

1. Tool connectivity recovered on 2026-09-06. Repository main starts clean at
   `f218a17`. Earlier failed tool calls did not inspect or modify this repository.
2. The Store source remains Windows 26.901.5280.0. Windows installer and macOS
   launcher configuration deliberately share the original CODEX_HOME; the
   provider hook intercepts thread creation but not native configuration writes.
   The original CLI config currently selects `gpt-5.6-sol` at `medium`.
3. Saved provider definitions include effort names beyond the installed engine's
   historical enum. Measure the running engine contract before changing mapping.
   Back up auth, native config, account store and encrypted provider store before
   any live test. Tests use a dedicated directory under LocalAppData.
4. Engine 0.153.4 accepts `none`, `minimal`, `low`, `medium`, `high`, `xhigh`,
   `max`, and `ultra`. A request using each value reaches thread lookup instead
   of failing enum validation. Do not map `max` to `xhigh` based on old schemas.
5. The initial real Go matrix exercised ten models and 31 effort combinations
   with the official app server and separate test homes. Twenty-four completed
   file reads and writes. Grok 4.5 rejected `client_metadata`; Grok 4.6 returned
   HTTP 422. The subsequent request without metadata exposed Grok 4.5's rejection
   of namespace tools. Bare Responses requests to both Grok models completed
   successfully. Chat Completions is not a supported Go format for Grok 4.6.
6. A real model-picker action wrote the external model into `config.toml`.
   The original design shared that file with the CLI. The fix initializes a
   private home before the hub and upstream app server start. Its one-time
   import snapshots active SQLite databases and rewrites transcript paths in
   the imported thread database. No links to writable original state are made.
7. Eight isolation tests cover config/auth writes, repeat installation, active
   WAL snapshots, resume paths, overlapping paths/junctions, incomplete imports,
   and excluded transient state. Windows installer and uninstaller register
   Claude peers only in the private home. The matching macOS flow was updated;
   macOS execution has not been tested on this Windows host.
8. Live diagnostics initially replaced an AppServerManager instance method.
   RpcTarget rejects instance properties over RPC, so that instrumentation
   caused config reads to fail and the composer to fall back to Astra. Reloading
   and instrumenting the prototype restored the actual flow. This fallback is
   not counted as a product defect. With valid instrumentation the selected
   external model remains selected.
9. Three independent request-contract regressions reproduced actual defects:
   route preparation overwrote the selected effort, a thread with no explicit
   model did not resolve the private default provider, and the turn guard
   ignored the model inside `collaborationMode.settings`. All three now pass.
   Native resumes retain their original provider. Remote hosts do not advertise
   locally connected providers. Nine request/catalog regression tests pass.
10. The native catalog normalizer filters efforts through ChatGPT feature flags.
    In the live picker Muse initially exposed four positions although its saved
    catalog declares five. External rows now retain provider-declared effort
    capabilities while native filtering remains unchanged.
11. External Responses requests flatten namespaces and custom tools into standard
    functions. Stream events and conversation history restore their original
    names, namespaces, custom inputs, and tool-call IDs. Native encrypted
    reasoning items are preserved. Adapter regression tests include a complete
    custom-tool round trip. Desktop-only `client_metadata` is removed.
12. The first private-home launch requires Windows sandbox setup. The app's own
    setup flow returned "Setup stopped"; the user was asked whether a Windows
    administrator permission dialog appeared. No sandbox credentials or setup
    marker were copied from the original home to bypass this requirement.
13. Grok 4.6's remaining failures were narrowed separately. Function definitions
    worked; `web_search.external_web_access: true` failed. Omitting that redundant
    online flag worked, while explicit `false` remains unchanged. The next tool
    round failed on `reasoning.content: null`; omitting only that empty field
    preserved the encrypted reasoning state and completed the round trip.
14. The real Desktop request included installed MCP tools absent from the empty
    test homes. Muse rejected recursive JSON schemas. Recursive argument schemas
    now use a JSON string envelope at the provider boundary; history and streamed
    calls unwrap back into the original arguments before native validation.
    With the full installed tool catalog, Muse/xhigh in Default mode and
    DeepSeek V4 Flash/max in Plan mode both returned `CODEXPP_PRIVATE_OK`.
    Both reported `modelProvider=cxp-external`, retained the selected effort,
    and stored their transcripts inside the private home. These checks validate
    catalog acceptance and routing; they do not execute every installed MCP tool.
15. A transcript-path audit caught ten Windows extended-length paths that were
    not rebased by a plain `path.relative` comparison. Both paths now pass through
    `path.toNamespacedPath`. A regression covers ordinary and extended paths.
    The private database was backed up before repairing these ten imported rows.
    The final audit found 190/190 private paths and zero missing transcripts.
    Snapshot ordering also protects against threads created during file copying.
16. Installed the reviewed candidate into `%LOCALAPPDATA%/Programs/CodexPP`.
    Backup: `CodexPP/backups/provider-isolation-20260905230614Z`.
    Installed EXE/ASAR match the candidate; all 27 hub files match the repository.
    The Store ASAR hash remains unchanged. Original CLI auth/config hashes match
    their starting values; the CLI still selects Sol/medium. Claude peers was
    registered in the private home. Test chats were archived and the account
    store was restored after testing. Private provider routing/usage reflects
    the test requests; encrypted connection keys were never displayed.
17. The installed application reopened with Muse/medium, a ready profile menu,
    and the complete external catalog. Its direct sandbox readiness response is
    `updateRequired`. The temporary composer prompt was cleared. All 190 stored
    transcript paths now point inside the private home, including the ten Windows
    extended-length paths; none point back to the CLI home.

## Validation results

All 47 automated tests pass. All 19 patches apply to the extracted Store source,
and all seven changed bundles parse successfully. The live model list and effort
slider saved all 30 selectable efforts correctly across ten models, retained the
selection after closing the menu, and exercised scrolling to the lower rows.
MiniMax has no configurable effort and was tested with its default.

| Model | Efforts tested | Real read/write |
|---|---|---|
| Muse Spark 1.3 Contributor | minimal, low, medium, high, xhigh | 5/5 |
| GPT-5.6 Luna | low, medium, high, xhigh, max | 5/5 |
| Grok 4.6 | low, medium, high, xhigh | 4/4 |
| Grok 4.5 | low, medium, high | 3/3 |
| DeepSeek V4 Flash | low, high, max | 3/3 |
| DeepSeek V4 Pro | high, max | 2/2 |
| Kimi K3 | low, high, max | 3/3 |
| GLM-5.3 Flash | low, high, max | 3/3 |
| Hy4 Preview | minimal, high | 2/2 |
| MiniMax M2.7 | default | 1/1 |

The final combined matrix is **31/31**. It retains earlier attempts separately:
one Muse/low attempt returned an upstream HTTP 500 and succeeded on retry;
Grok was repeated after the demonstrated adapter fixes. Every successful case
used `cxp-external`, returned HTTP 200, and forwarded no ChatGPT account header.
The Windows setup banner still prevents a normal composer send until the OS
setup step is completed. Direct Desktop request-client checks passed as described
above; this remaining UI prerequisite is not reported as a completed check.

## Local evidence

Private, untracked evidence lives under `%LOCALAPPDATA%/CodexPP-provider-0906`:
`backup/`, `original-hashes.json`, `matrix-final.json`, `picker-matrix.json`, and the test home/work
directories. Repository-local scripts and logs are under `.build/`. Provider
keys remain encrypted on disk and are decrypted only into request headers.
The final tool matrix uses a fresh random read value and a different random
write value for every case, so a file left by an earlier run cannot pass.
