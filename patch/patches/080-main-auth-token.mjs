const NAME = "[A-Za-z_$][\\w$]*";

const PATTERN = new RegExp(
  `(${NAME})\\?\\.authMethod===\`chatgpt\`\\?\\1\\.authToken\\?\\?null:null`,
  "g"
);

export default {
  id: "080-main-auth-token",
  description: "Let the main process attach the auth token when the host supplies the ChatGPT session",
  glob: ".vite/build/src-*.js",
  select: "app_server_connection.auth_status_result",
  marker: "chatgptAuthTokens",
  apply(source) {
    const matches = [...source.matchAll(PATTERN)];
    if (matches.length !== 2) {
      throw new Error(`auth token gate had to match twice, matched ${matches.length} times`);
    }

    let result = "";
    let cursor = 0;
    for (const match of matches) {
      const response = match[1];
      result +=
        source.slice(cursor, match.index) +
        `(${response}?.authMethod===\`chatgpt\`||${response}?.authMethod===\`chatgptAuthTokens\`)` +
        `?${response}.authToken??null:null`;
      cursor = match.index + match[0].length;
    }
    return result + source.slice(cursor);
  }
};
