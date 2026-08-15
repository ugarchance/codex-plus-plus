#!/bin/bash
set -euo pipefail

SRC_APP="${SRC_APP:-/Applications/ChatGPT.app}"
DEST_APP="${DEST_APP:-/Applications/Codex++.app}"
BUNDLE_ID="${BUNDLE_ID:-com.local.codexpp}"
APP_NAME="Codex++"
USER_DATA_DIR="${USER_DATA_DIR:-$HOME/Library/Application Support/CodexPP}"
CODEX_HOME_SHARED="${CODEX_HOME_SHARED:-$HOME/.codex}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENT="$REPO_DIR/.build/entitlements.plist"

die() { echo "hata: $*" >&2; exit 1; }
info() { echo "==> $*"; }

require_source() {
  [ -d "$SRC_APP" ] || die "kaynak uygulama yok: $SRC_APP"
  [ -f "$SRC_APP/Contents/Resources/app.asar" ] || die "app.asar bulunamadi, beklenmeyen surum"
  local v
  v="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$SRC_APP/Contents/Info.plist")"
  info "kaynak surum: $v"
}

copy_bundle() {
  info "kopyalaniyor -> $DEST_APP"
  rm -rf "$DEST_APP"
  ditto "$SRC_APP" "$DEST_APP"
  rm -f "$DEST_APP/Contents/embedded.provisionprofile"
  rm -rf "$DEST_APP/Contents/_CodeSignature"
}

install_launcher() {
  info "launcher derleniyor"
  command -v clang >/dev/null || die "clang yok. Xcode Command Line Tools gerekli: xcode-select --install"
  local macos="$DEST_APP/Contents/MacOS"
  local real
  real="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$SRC_APP/Contents/Info.plist")"
  mv "$macos/$real" "$macos/$APP_NAME-bin"
  clang -O2 -Wall -Wextra \
        -DREAL_EXEC="\"$APP_NAME-bin\"" \
        -DUSER_DATA_DIR="\"$USER_DATA_DIR\"" \
        -o "$macos/$APP_NAME" "$REPO_DIR/src/launcher.c"
}

apply_patches() {
  info "asar yamalaniyor"
  command -v node >/dev/null || die "node yok. Node.js gerekli: https://nodejs.org"
  if [ ! -d "$REPO_DIR/patch/node_modules" ]; then
    info "patch bagimliliklari kuruluyor"
    npm --prefix "$REPO_DIR/patch" install --no-audit --no-fund
  fi
  node "$REPO_DIR/patch/apply.mjs" \
       --src "$SRC_APP/Contents/Resources/app.asar" \
       --out "$DEST_APP/Contents/Resources/app.asar"
}

install_hub() {
  info "hub kopyalaniyor"
  local res="$DEST_APP/Contents/Resources"
  rm -rf "$res/hub"
  cp -R "$REPO_DIR/hub" "$res/hub"
}

edit_plist() {
  info "Info.plist duzenleniyor"
  local pl="$DEST_APP/Contents/Info.plist"
  plutil -remove ElectronAsarIntegrity "$pl" 2>/dev/null || true
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

sign_bundle() {
  info "ad-hoc imzalaniyor (icten disa)"
  find "$DEST_APP" -mindepth 1 \
       \( -name '*.app' -o -name '*.framework' -o -name '*.xpc' \
          -o -name '*.docktileplugin' -o -name '*.dylib' -o -name '*.so' -o -name '*.node' \) \
    | awk '{print gsub(/\//,"/") "\t" $0}' | sort -rn | cut -f2- \
    | while IFS= read -r p; do
        [ -e "$p" ] || continue
        codesign --force --sign - --timestamp=none --options runtime "$p" 2>/dev/null \
          || codesign --force --sign - --timestamp=none "$p" 2>/dev/null \
          || echo "    ! imzalanamadi: ${p#"$DEST_APP"/}"
      done

  local res="$DEST_APP/Contents/Resources"
  for b in codex codex-code-mode-host codex_chronicle rg; do
    [ -f "$res/$b" ] && codesign --force --sign - --timestamp=none --options runtime "$res/$b" 2>/dev/null || true
  done

  codesign --force --sign - --timestamp=none --options runtime \
           --entitlements "$ENT" "$DEST_APP/Contents/MacOS/$APP_NAME-bin"

  codesign --force --sign - --timestamp=none --options runtime --entitlements "$ENT" "$DEST_APP"
  codesign --verify --strict "$DEST_APP" || die "imza dogrulanamadi"
  xattr -cr "$DEST_APP" 2>/dev/null || true
}

summary() {
  info "kurulum tamam"
  echo
  echo "  uygulama    : $DEST_APP"
  echo "  bundle id   : $BUNDLE_ID"
  echo "  user data   : $USER_DATA_DIR"
  echo "  CODEX_HOME  : $CODEX_HOME_SHARED  (orijinal ile ortak)"
  echo
  echo "  ac: open -a \"$DEST_APP\""
}

case "${1:-install}" in
  install)
    require_source
    copy_bundle
    install_launcher
    apply_patches
    install_hub
    edit_plist
    write_entitlements
    sign_bundle
    summary
    ;;
  uninstall)
    info "kaldiriliyor: $DEST_APP"
    rm -rf "$DEST_APP"
    echo "not: $USER_DATA_DIR silinmedi. gerekiyorsa elle sil."
    ;;
  *)
    die "kullanim: $0 [install|uninstall]"
    ;;
esac
