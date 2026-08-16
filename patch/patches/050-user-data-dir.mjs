import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

const NAME = "[A-Za-z_$][\\w$]*";
const GUARD = "_cxpUserDataDir";

const PATTERN =
  `(${NAME})\\.app\\.setPath\\(\`userData\`,(${NAME})\\(\\{appDataPath:\\1\\.app\\.getPath\\(\`appData\`\\),` +
  `buildFlavor:(${NAME}),env:process\\.env\\}\\)\\)`;

export default {
  id: "050-user-data-dir",
  description: "Skip the built-in userData path switch when the launcher supplied one",
  glob: ".vite/build/bootstrap-*.js",
  marker: GUARD,
  apply(source) {
    const [anchor] = matchOnce(source, PATTERN, "userData path switch");
    const guarded =
      `(process.argv.some(${GUARD}=>${GUARD}.startsWith(\`--user-data-dir=\`))||${anchor})`;
    return replaceOnce(source, anchor, guarded);
  }
};
