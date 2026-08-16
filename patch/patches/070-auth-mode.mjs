import { matchOnce } from "../lib/anchor.mjs";

const NAME = "[A-Za-z_$][\\w$]*";
const MARKER = "_cxpAuthMode";

const STATUS_PATTERN = `notifyAuthStatusCallbacks\\((${NAME})\\)\\{for\\(let ${NAME} of this\\.authStatusCallbacks\\)`;

const METHOD_PATTERN =
  `async getAuthMethod\\((${NAME})\\)\\{let\\{authMethod:(${NAME})\\}=await this\\.sendRequest\\(` +
  "`getAuthStatus`,\\{includeToken:!1,refreshToken:!1\\},\\1\\);return \\2\\}";

function replaceAll(source, pattern, label, expected, build) {
  const matches = [...source.matchAll(new RegExp(pattern, "g"))];
  if (matches.length !== expected) {
    throw new Error(`pattern ${label} had to match ${expected} times, matched ${matches.length} times`);
  }

  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += source.slice(cursor, match.index) + build(match);
    cursor = match.index + match[0].length;
  }
  return result + source.slice(cursor);
}

export default {
  id: "070-auth-mode",
  description: "Treat host-supplied chatgptAuthTokens auth as a normal ChatGPT session in the UI",
  glob: "webview/assets/app-initial-*.js",
  marker: MARKER,
  apply(source) {
    const status = matchOnce(source, STATUS_PATTERN, "auth status broadcast");
    const mode = status[1];
    const normalized =
      status[0].replace(
        `notifyAuthStatusCallbacks(${mode}){`,
        `notifyAuthStatusCallbacks(${mode}){const ${MARKER}=\`chatgptAuthTokens\`;` +
          `${mode}===${MARKER}&&(${mode}=\`chatgpt\`);`
      );

    const withStatus =
      source.slice(0, status.index) + normalized + source.slice(status.index + status[0].length);

    return replaceAll(withStatus, METHOD_PATTERN, "auth method read", 2, (match) =>
      match[0].replace(
        `return ${match[2]}}`,
        `return ${match[2]}===\`chatgptAuthTokens\`?\`chatgpt\`:${match[2]}}`
      )
    );
  }
};
