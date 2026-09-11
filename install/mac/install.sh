#!/bin/bash
set -euo pipefail

SRC_APP="${SRC_APP:-/Applications/ChatGPT.app}"
DEST_APP="${DEST_APP:-/Applications/Codex++.app}"
BUNDLE_ID="${BUNDLE_ID:-com.local.codexpp}"
APP_NAME="Codex++"
USER_DATA_DIR="${USER_DATA_DIR:-$HOME/Library/Application Support/CodexPP}"
ALLOW_UNTESTED_SOURCE="${ALLOW_UNTESTED_SOURCE:-}"
CODEX_HOME_SHARED="${CODEX_HOME_SHARED:-$HOME/.codex}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENT="$REPO_DIR/.build/entitlements.plist"
COMPUTER_USE_REL="Contents/Resources/cua_node/lib/node_modules/@oai/sky/Codex Computer Use.app"

die() { echo "error: $*" >&2; exit 1; }
info() { echo "==> $*"; }

gate() {
  [ -d "$SRC_APP" ] || die "source app not found: $SRC_APP"
  local plist="$SRC_APP/Contents/Info.plist"
  [ -f "$plist" ] || die "Info.plist not found: $plist"
  [ -f "$SRC_APP/Contents/Resources/app.asar" ] || die "app.asar not found, unexpected build"
  local v b
  v="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null)" || die "could not read CFBundleShortVersionString"
  b="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist" 2>/dev/null)" || die "could not read CFBundleVersion"
  info "source version: $v ($b)"
  verify_computer_use_runtime "$SRC_APP"
}

require_source() {
  gate
}

backup_existing_app() {
  if [ -e "$DEST_APP" ] || [ -d "$DEST_APP" ]; then
    local ts backup_dir backup_target
    ts="$(date -u +%Y%m%d%H%M%SZ)"
    backup_dir="$USER_DATA_DIR/backups"
    backup_target="$backup_dir/${APP_NAME}-${ts}.app"
    info "backing up existing app -> $backup_target"
    mkdir -p "$backup_dir"
    mv "$DEST_APP" "$backup_target"
  fi
}

copy_bundle() {
  backup_existing_app
  info "copying -> $DEST_APP"
  ditto "$SRC_APP" "$DEST_APP"
  rm -f "$DEST_APP/Contents/embedded.provisionprofile"
  rm -rf "$DEST_APP/Contents/_CodeSignature"
}

install_launcher() {
  info "compiling launcher"
  command -v clang >/dev/null || die "clang not found. Xcode Command Line Tools required: xcode-select --install"
  local macos="$DEST_APP/Contents/MacOS"
  local real
  real="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$SRC_APP/Contents/Info.plist")"
  mv "$macos/$real" "$macos/$APP_NAME-bin"
  clang -O2 -Wall -Wextra \
        -DREAL_EXEC="\"$APP_NAME-bin\"" \
        -DUSER_DATA_DIR="\"$USER_DATA_DIR\"" \
        -o "$macos/$APP_NAME" "$REPO_DIR/install/mac/launcher.c"
  # Keychain helper for provider API keys (hub/provider-secrets.cjs); this
  # Electron build has no safeStorage binding on macOS either.
  info "compiling keychain helper"
  clang -O2 -Wall -Wextra -framework Security -framework CoreFoundation \
        -o "$macos/codexpp-keychain" "$REPO_DIR/install/mac/keychain.c"
}

apply_patches() {
  info "patching asar"
  command -v node >/dev/null || die "node not found. Node.js required: https://nodejs.org"
  # Same as the Windows installer: always install the locked dependency set, so
  # an update that adds a patch dependency does not run against a stale
  # node_modules left behind by an earlier install.
  info "installing locked patch dependencies"
  npm --prefix "$REPO_DIR/patch" ci --no-audit --no-fund || die "npm ci failed"
  local patch_args=(
    --src "$SRC_APP/Contents/Resources/app.asar"
    --out "$DEST_APP/Contents/Resources/app.asar"
  )
  if [ -n "${ALLOW_UNTESTED_SOURCE:-}" ]; then
    patch_args+=(--allow-untested-source)
  fi
  node "$REPO_DIR/patch/apply.mjs" "${patch_args[@]}"
  # Builds with the embedded-integrity fuse on (26.901+) abort at startup
  # unless Info.plist carries the patched asar's header hash.
  node "$REPO_DIR/patch/mac-integrity.mjs" "$DEST_APP/Contents/Info.plist" \
    "$SRC_APP/Contents/Resources/app.asar" "$DEST_APP/Contents/Resources/app.asar" \
    || die "macOS ASAR integrity update failed"
}

install_hub() {
  info "installing locked hub dependencies"
  (cd "$REPO_DIR/hub" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund) || die "hub npm ci failed"
  info "copying hub"
  local res="$DEST_APP/Contents/Resources"
  rm -rf "$res/hub"
  cp -R "$REPO_DIR/hub" "$res/hub"
  cp "$REPO_DIR/THIRD_PARTY_NOTICES.md" "$res/hub/THIRD_PARTY_NOTICES.md"
}

install_claude_peers() {
  if [ -n "${SKIP_CLAUDE_PEERS:-}" ]; then
    info "skipping claude-peers (SKIP_CLAUDE_PEERS set)"
    return 0
  fi
  info "registering claude-peers MCP server"
  node "$REPO_DIR/integrations/claude-peers/install.mjs" --codex-home "$CODEX_HOME_SHARED" \
    || echo "    ! claude-peers registration failed, continuing"
}

edit_plist() {
  info "editing Info.plist"
  local pl="$DEST_APP/Contents/Info.plist"
  # ElectronAsarIntegrity is kept on purpose: apply_patches rewrote its hash.
  plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$pl"
  plutil -replace CFBundleName       -string "$APP_NAME"  "$pl"
  plutil -replace CFBundleExecutable -string "$APP_NAME"  "$pl"
  plutil -replace CFBundleDisplayName -string "$APP_NAME" "$pl" 2>/dev/null \
    || plutil -insert CFBundleDisplayName -string "$APP_NAME" "$pl"

  plutil -insert LSEnvironment -xml '<dict/>' "$pl" 2>/dev/null || true
  plutil -replace LSEnvironment.CODEX_HOME -string "$CODEX_HOME_SHARED" "$pl" 2>/dev/null \
    || plutil -insert LSEnvironment.CODEX_HOME -string "$CODEX_HOME_SHARED" "$pl"
  plutil -replace LSEnvironment.CODEX_SPARKLE_ENABLED -string "false" "$pl" 2>/dev/null \
    || plutil -insert LSEnvironment.CODEX_SPARKLE_ENABLED -string "false" "$pl"
  plutil -replace LSEnvironment.MallocNanoZone -string "0" "$pl" 2>/dev/null \
    || plutil -insert LSEnvironment.MallocNanoZone -string "0" "$pl"
}

write_entitlements() {
  mkdir -p "$(dirname "$ENT")"
  cat > "$ENT" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.app-sandbox</key><false/>
  <key>com.apple.security.automation.apple-events</key><true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
  <key>com.apple.security.device.camera</key><true/>
  <key>com.apple.security.files.user-selected.read-write</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.personal-information.calendars</key><true/>
</dict></plist>
PLIST
}

# Keep the OpenAI Developer ID signature on codex and codex-code-mode-host:
# it already carries allow-jit / allow-unsigned-executable-memory (so
# codex-code-mode-host's V8 starts without "Failed to reserve virtual memory
# for CodeRange"), AND it keeps team 2DC432GLL2, which native Computer Use
# needs. The external SkyComputerUseService only serves a peer whose process
# ancestry contains a team-2DC432GLL2 signer; codex is node_repl's parent, so
# an ad-hoc re-sign there (no team) makes the service reject cua_repl with
# "Sky Computer Use native pipe startup failed". ditto preserves those
# signatures on copy and nothing else re-signs these two Mach-Os, so leave
# them untouched. The service bundle also needs its own TeamIdentifier; the
# recursive signer below must preserve that entire subtree, including its
# nested client, frameworks and entitlements. codex_chronicle and rg carry no
# such requirement; re-signing them ad-hoc with $ENT is harmless.
verify_computer_use_runtime() {
  local app="$1" rel metadata
  # Older source builds may not ship the native Computer Use runtime.
  [ -d "$app/$COMPUTER_USE_REL" ] || return 0
  for rel in Contents/Resources/codex Contents/Resources/codex-code-mode-host \
             Contents/Resources/cua_node/bin/node Contents/Resources/cua_node/bin/node_repl \
             "$COMPUTER_USE_REL"; do
    [ -e "$app/$rel" ] || die "Computer Use runtime missing: $app/$rel"
    codesign --verify --deep --strict "$app/$rel" \
      || die "invalid Computer Use signature: $app/$rel; reinstall from the original source app"
    metadata="$(codesign -dv "$app/$rel" 2>&1)" \
      || die "could not inspect Computer Use signature: $app/$rel"
    printf '%s\n' "$metadata" | grep -qx 'TeamIdentifier=2DC432GLL2' \
      || die "Computer Use requires the original OpenAI signature: $app/$rel; reinstall from the original source app"
  done
}

sign_helpers() {
  local res="$DEST_APP/Contents/Resources"
  for b in codex_chronicle rg; do
    [ -f "$res/$b" ] || continue
    codesign --force --sign - --timestamp=none --options runtime --entitlements "$ENT" "$res/$b" 2>/dev/null \
      || echo "    ! could not sign: Resources/$b"
  done
}

sign_bundle() {
  verify_computer_use_runtime "$DEST_APP"
  info "ad-hoc signing (inside out)"
  find "$DEST_APP" -mindepth 1 \
       -path "$DEST_APP/$COMPUTER_USE_REL" -prune -o \
       \( -name '*.app' -o -name '*.framework' -o -name '*.xpc' \
          -o -name '*.docktileplugin' -o -name '*.dylib' -o -name '*.so' -o -name '*.node' \) -print \
    | awk '{print gsub(/\//,"/") "\t" $0}' | sort -rn | cut -f2- \
    | while IFS= read -r p; do
        [ -e "$p" ] || continue
        codesign --force --sign - --timestamp=none --options runtime --entitlements "$ENT" "$p" 2>/dev/null \
          || codesign --force --sign - --timestamp=none "$p" 2>/dev/null \
          || echo "    ! could not sign: ${p#"$DEST_APP"/}"
      done

  sign_helpers

  codesign --force --sign - --timestamp=none --options runtime \
           --entitlements "$ENT" "$DEST_APP/Contents/MacOS/$APP_NAME-bin"
  codesign --force --sign - --timestamp=none --options runtime \
           "$DEST_APP/Contents/MacOS/codexpp-keychain"

  codesign --force --sign - --timestamp=none --options runtime --entitlements "$ENT" "$DEST_APP"
  codesign --verify --strict "$DEST_APP" || die "signature verification failed"
  verify_computer_use_runtime "$DEST_APP"
  xattr -cr "$DEST_APP" 2>/dev/null || true
}

reseal_bundle() {
  verify_computer_use_runtime "$DEST_APP"
  info "re-sealing bundle"
  codesign --force --sign - --timestamp=none --options runtime \
           --entitlements "$ENT" "$DEST_APP/Contents/MacOS/$APP_NAME-bin"
  codesign --force --sign - --timestamp=none --options runtime --entitlements "$ENT" "$DEST_APP"
  codesign --verify --strict "$DEST_APP" || die "signature verification failed"
  verify_computer_use_runtime "$DEST_APP"
  xattr -cr "$DEST_APP" 2>/dev/null || true
}

summary() {
  info "install complete"
  echo
  echo "  app         : $DEST_APP"
  echo "  bundle id   : $BUNDLE_ID"
  echo "  user data   : $USER_DATA_DIR"
  echo "  CODEX_HOME  : $CODEX_HOME_SHARED  (shared with the original)"
  if [ -z "${SKIP_CLAUDE_PEERS:-}" ]; then
    echo "  claude-peers: $CODEX_HOME_SHARED/mcp/claude-peers  (Claude sessions as Codex tools)"
  fi
  echo
  echo "  run: open -a \"$DEST_APP\""
}

# Allow the signing functions to be exercised against disposable bundles.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
case "${1:-install}" in
  install)
    gate
    copy_bundle
    install_launcher
    apply_patches
    install_hub
    install_claude_peers
    edit_plist
    write_entitlements
    sign_bundle
    summary
    ;;
  resign)
    [ -d "$DEST_APP" ] || die "not installed: $DEST_APP"
    pgrep -qf "$(printf '%s' "$DEST_APP/Contents/MacOS/" | sed 's/[][\\.*^$+?()|{}]/\\&/g')" && die "quit $APP_NAME before re-signing"
    write_entitlements
    sign_helpers
    reseal_bundle
    info "helpers re-signed with entitlements and bundle re-sealed"
    ;;
  hub)
    [ -d "$DEST_APP" ] || die "not installed: $DEST_APP"
    pgrep -qf "$(printf '%s' "$DEST_APP/Contents/MacOS/" | sed 's/[][\\.*^$+?()|{}]/\\&/g')" && die "quit $APP_NAME before updating the hub"
    install_hub
    write_entitlements
    reseal_bundle
    info "hub updated"
    ;;
  gate|check)
    gate
    ;;
  uninstall)
    info "removing: $DEST_APP"
    rm -rf "$DEST_APP"
    node "$REPO_DIR/integrations/claude-peers/install.mjs" --codex-home "$CODEX_HOME_SHARED" --remove \
      || echo "    ! claude-peers removal failed"
    echo "note: $USER_DATA_DIR was kept. delete it manually if you want a clean slate."
    ;;
  *)
    die "usage: $0 [install|hub|resign|gate|uninstall]"
    ;;
esac
fi
