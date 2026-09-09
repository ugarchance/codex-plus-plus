import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

/**
 * Patch 094: Navigation bridge
 *
 * The renderer keeps its router callbacks in an "AppNavigationSignalBridge"
 * store entry ({navigate, navigateToLocalConversation, pathname,
 * prepareNavigation}); chunks reach it through the store. Patch 095 lives in
 * the local-conversation-page chunk and needs to open the chat it just
 * created, so the same callbacks are published on globalThis whenever the
 * bridge is (re)installed.
 */

const NAME = "[A-Za-z_$][\\w$]*";
const MARKER = "__cxpNavigation";
const PATTERN =
  `\\.set\\((${NAME}),\\{navigate:(${NAME}),navigateToLocalConversation:(${NAME}),` +
  `pathname:(${NAME}),prepareNavigation:(${NAME})\\}\\)`;

export default {
  id: "094-navigation-bridge",
  description: "Publish the router's navigate callbacks for other chunks",
  glob: "webview/assets/app-initial-*.js",
  marker: MARKER,
  apply(source) {
    const [anchor, , navigate, toLocal] = matchOnce(source, PATTERN, "app navigation bridge installer");
    return replaceOnce(
      source,
      anchor,
      `${anchor},globalThis.${MARKER}={navigate:${navigate},navigateToLocalConversation:${toLocal}}`
    );
  }
};
