// Exercise the installer's actual find/sign traversal without touching an app.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.log("macOS signing traversal: skipped on Windows (requires POSIX find)");
  process.exit(0);
}

const installer = fileURLToPath(new URL("../install/mac/install.sh", import.meta.url));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "cxp-computer-use-signing-"));
const app = path.join(work, "Codex++.app");
const service = "Contents/Resources/cua_node/lib/node_modules/@oai/sky/Codex Computer Use.app";
const log = path.join(work, "signatures.log");
const harness = `
source "$1"
codesign() {
  local target="\${!#}"
  case "$1" in
    --force) printf '%s\\n' "$target" >> "$SIGNING_TEST_LOG" ;;
    --verify) [ "$target" != "\${SIGNING_TEST_INVALID:-}" ] ;;
    -dv)
      if [ "$target" = "\${SIGNING_TEST_ADHOC:-}" ]; then
        echo 'TeamIdentifier=not set'
      else
        echo 'TeamIdentifier=2DC432GLL2'
      fi
      ;;
    *) return 1 ;;
  esac
}
xattr() { :; }
"$2"
`;

function run(operation, extraEnv = {}) {
  fs.writeFileSync(log, "");
  const result = spawnSync("bash", ["-c", harness, "signing-test", installer, operation], {
    encoding: "utf8",
    env: { ...process.env, DEST_APP: app, SIGNING_TEST_LOG: log, ...extraEnv },
  });
  assert.ifError(result.error);
  return { ...result, signed: fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean) };
}

try {
  const files = [
    "Contents/Resources/codex", "Contents/Resources/codex-code-mode-host",
    "Contents/Resources/codex_chronicle", "Contents/Resources/rg",
    "Contents/Resources/cua_node/bin/node", "Contents/Resources/cua_node/bin/node_repl",
    "Contents/MacOS/Codex++", "Contents/MacOS/Codex++-bin", "Contents/MacOS/codexpp-keychain",
    "Contents/Frameworks/Other.app/Contents/MacOS/helper",
    "Contents/Resources/native/other.node",
    `${service}/Contents/MacOS/SkyComputerUseService`,
    `${service}/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient`,
    `${service}/Contents/Frameworks/Nested.framework/Versions/A/Nested`,
    `${service}/Contents/Frameworks/embedded.dylib`,
    `${service}/Contents/Resources/embedded.node`,
  ];
  for (const rel of files) {
    const target = path.join(app, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "original");
  }

  for (const operation of ["sign_bundle", "reseal_bundle"]) {
    const result = run(operation);
    assert.equal(result.status, 0, result.stderr);
    assert(result.signed.includes(app), "outer app must be sealed");
    assert(result.signed.includes(path.join(app, "Contents/MacOS/Codex++-bin")));
    assert(!result.signed.some(target => target.includes("/cua_node/") || target.endsWith("/codex") || target.endsWith("/codex-code-mode-host")), "native service, descendants and trusted ancestors must retain their signatures");
    if (operation === "sign_bundle") {
      assert(result.signed.includes(path.join(app, "Contents/Frameworks/Other.app")), "unrelated nested apps still signed");
      assert(result.signed.includes(path.join(app, "Contents/Resources/native/other.node")));
      assert(result.signed.includes(path.join(app, "Contents/Resources/codex_chronicle")));
    }

    for (const rel of [service, "Contents/Resources/codex", "Contents/Resources/codex-code-mode-host", "Contents/Resources/cua_node/bin/node", "Contents/Resources/cua_node/bin/node_repl"]) {
      const rejected = run(operation, { SIGNING_TEST_ADHOC: path.join(app, rel) });
      assert.notEqual(rejected.status, 0, "ad-hoc trusted runtime must fail closed");
      assert.match(rejected.stderr, /requires the original OpenAI signature/);
      assert.equal(rejected.signed.length, 0, "preflight must fail before signing anything");
    }
    const invalid = run(operation, { SIGNING_TEST_INVALID: path.join(app, service) });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /invalid Computer Use signature/);
    assert.equal(invalid.signed.length, 0);
  }

  fs.unlinkSync(path.join(app, "Contents/Resources/cua_node/bin/node_repl"));
  const missing = run("sign_bundle");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Computer Use runtime missing/);
  assert.equal(missing.signed.length, 0);

  // Old bundles without native Computer Use still follow the original flow.
  fs.renameSync(path.join(app, service), path.join(work, "legacy-removed-service.app"));
  assert.equal(run("sign_bundle").status, 0);
  console.log("macOS Computer Use signing: subtree preservation, ordinary signing, reseal, ad-hoc/invalid/missing rejection and legacy cases passed");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
