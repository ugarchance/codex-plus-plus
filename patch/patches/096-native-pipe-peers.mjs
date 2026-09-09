import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

/**
 * Patch 096: Native pipe peer authorization (macOS)
 *
 * The main process listens on three loopback pipes under /tmp (browser-use,
 * dynamic app tools, node REPL host services) that Computer Use, the codex
 * app-server and the code-mode host connect to. On macOS a native addon
 * (`browser-use-peer-authorization.node`) vets every connecting peer, and it
 * only ever says yes when the host is an OpenAI-signed Codex bundle
 * (team 2DC432GLL2, identifier com.openai.codex*). Under the ad-hoc
 * `com.local.codexpp` bundle every peer is rejected with
 * `missing-code-signing-identity`, so tools/list never reaches the engine and
 * Computer Use reports "native pipe startup failed". This patch returns the
 * permissive authorizer the app already uses on other platforms and logs why.
 * The pipes stay chmod 0600, so only this user's processes can connect.
 */

const NAME = "[A-Za-z_$][\\w$]*";
const MARKER = "codexpp-adhoc-bundle";
const FACTORY =
  `function (${NAME})\\(\\)\\{if\\(process\\.platform!==\`darwin\`\\)return\\(\\)=>\\(\\{authorized:!0\\}\\);` +
  `let (${NAME})=(${NAME})\\.(${NAME})\\.readFromPackageMetadata\\(\\),`;

export default {
  id: "096-native-pipe-peers",
  description: "Accept local native-pipe peers under the ad-hoc bundle (macOS)",
  glob: ".vite/build/main-*.js",
  marker: MARKER,
  apply(source) {
    const [anchor, factory] = matchOnce(source, FACTORY, "native pipe peer authorizer factory");
    const start = source.indexOf(anchor);
    const window = source.slice(start, start + 2000);
    const [, logger] = matchOnce(
      window,
      `return (${NAME})\\(\\)\\.info\\(\`browser-use native pipe peer authorization enabled\``,
      "peer authorizer logger"
    );
    const head = `function ${factory}(){`;
    const replacement =
      head +
      `if(process.platform===\`darwin\`){try{${logger}().info(\`browser-use native pipe peer authorization disabled\`,` +
      `{safe:{reason:\`${MARKER}\`},sensitive:{}})}catch{}return()=>({authorized:!0})}` +
      anchor.slice(head.length);
    return replaceOnce(source, anchor, replacement);
  }
};
