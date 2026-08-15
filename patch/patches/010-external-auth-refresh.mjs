import { replaceOnce } from "../lib/anchor.mjs";

export default {
  id: "010-external-auth-refresh",
  description: "External auth token refresh hook",
  glob: "webview/assets/app-initial-*.js",
  marker: "__codexpp?.authRefresh",
  apply(source) {
    const anchor = "case`account/chatgptAuthTokens/refresh`:case`attestation/generate`:break;";
    const replacement = "case`account/chatgptAuthTokens/refresh`:{globalThis.__codexpp?.authRefresh?.(this.hostId,t,n);break}case`attestation/generate`:break;";
    return replaceOnce(source, anchor, replacement);
  }
};
