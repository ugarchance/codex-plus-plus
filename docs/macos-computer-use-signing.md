# macOS native Computer Use signing regression — 2026-09-09

## Measured failure

On Codex++ 26.901.51231, `cua.getApp("WhatsApp")` and `cua.getState()` failed
with `Sky Computer Use native pipe startup failed`. During those requests,
macOS logs recorded repeated `SlimCore.SkyIPCRequirement.Error.teamNotFound`
errors from `SkyComputerUseService`.

The engine and CUA Node executables already retained OpenAI team `2DC432GLL2`.
However, **both** the service shipped inside Codex++ and its deployed copy
under `CODEX_HOME/computer-use` were ad-hoc signed with `TeamIdentifier=not set`.
Their service executable hashes matched. The source in the unmodified
ChatGPT.app had the same version, a valid OpenAI signature, and passed
`codesign --verify --deep --strict`.

`sign_bundle` recursively signed every nested `.app`. Keeping `codex` and
`codex-code-mode-host` signed fixed the trusted ancestor requirement described
in [the earlier investigation](astra-macos-26.901.md), but left the service
itself and its nested client subject to re-signing on the next installation.
The previous investigation assumed the shared external service was pristine;
that assumption was false in this installation.

## Fix

The installer now prunes the complete
`Contents/Resources/cua_node/lib/node_modules/@oai/sky/Codex Computer Use.app`
subtree from signing. Skipping only the top-level app would still damage its
embedded clients or frameworks and invalidate its original resource seal.

Source preflight and destination checks validate both cryptographic integrity
and team `2DC432GLL2` for:

- `codex` and `codex-code-mode-host`;
- `cua_node/bin/node` and `node_repl`;
- the complete native service bundle, including nested code.

`sign_bundle` and `reseal_bundle` check before and after signing. An already
damaged service is rejected with an instruction to reinstall from the original
source. The outer Codex++ bundle stays ad-hoc signed. No native service code,
IPC authorization policy, connection timeout, or OS permission was changed.

## Verification

- `bash -n install/mac/install.sh` and `git diff --check` passed.
- `node tools/test-mac-computer-use-signing.mjs` exercised the actual shell
  traversal with a recording signer: nested service exclusion, normal signing,
  reseal, and rejection of ad-hoc, invalid or missing trusted runtime files.
  It also covered older bundles without the native service.
- Existing `test-mac-integrity.mjs` and `test-native-pipe-peers.mjs` passed.
- A separate full copy of the installed app received the original service and
  ran the **real** updated `sign_bundle`, including the recursive signing loop.
  The outer bundle verified; the service and trusted helpers still verified as
  OpenAI signed. The service executable remained byte-identical to the source.
- The verified copy replaced the installed bundle through a backed-up directory
  swap. The inactive shared service copy was similarly restored from the signed
  source. The original application was not modified.
- In the existing Codex++ session, native `cua.getApp("WhatsApp")` returned the
  actual window and accessibility tree. Clicking the File menu exposed its
  items, and its native `Cancel` action closed it. A window screenshot returned
  67,648 bytes. No messages were sent; private screen content was not saved in
  this repository.

The app's `app.asar` SHA256 before and after repair was
`32d8f32701feb315ce54abbe770ae77653484aaec22cf1a14c109522eab0a3b8`.
The restored service executable SHA256 was
`25e9141499b94c396f39afbdb7b19ed8f49e45dc8c61be61028ceab8f3807ce6`
in both the original source and deployed shared service.

This is live native UI acceptance, in addition to signature checks. A full
Codex++ quit/relaunch was not performed during the active session.
