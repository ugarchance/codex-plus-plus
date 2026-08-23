import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

/**
 * Patch 090: Auto-routing Core
 *
 * Discovery notes (docs/routing-anchors.md):
 * - Surface 1: AppServerManager.prototype.onNotification handling of thread/started
 *   and thread/unarchived to associate newly started or unarchived threads with the active account.
 * - Surface 3: ThreadCreation.prototype.createConversation to auto-route to the best eligible
 *   account when autoRoute is enabled before dispatching thread/start.
 */

const MARKER = "_cxpAutoRoutingCore";

const helpers = [
  `;(()=>{`,
  `  const ${MARKER} = true;`,
  `  globalThis.__cxpLearnThread = (_threadId) => {`,
  `    try {`,
  `      const _api = globalThis.__codexpp;`,
  `      if (!_api || !_threadId) return;`,
  `      const _view = _api.accountsSync?.();`,
  `      const _activeId = _view?.activeAccountId;`,
  `      if (_activeId) {`,
  `        _api.learnThreadOwner?.(_threadId, _activeId);`,
  `      }`,
  `    } catch {}`,
  `  };`,
  `  globalThis.__cxpAutoRoute = async () => {`,
  `    try {`,
  `      const _api = globalThis.__codexpp;`,
  `      if (!_api) return null;`,
  `      const _routing = _api.routingView?.();`,
  `      if (!_routing?.autoRoute) return null;`,
  `      const _suggest = await _api.routingSuggest?.();`,
  `      if (!_suggest?.accountId) return null;`,
  `      const _accounts = _api.accountsSync?.();`,
  `      if (_suggest.accountId !== _accounts?.activeAccountId) {`,
  `        await globalThis.__cxpActivate?.(_suggest.accountId);`,
  `      }`,
  `      return _suggest.accountId;`,
  `    } catch {`,
  `      return null;`,
  `    }`,
  `  };`,
  `})();`
].join("\n");

const NAME = "[A-Za-z_$][\\w$]*";

const STARTED_PATTERN =
  "case`thread/started`:\\{let\\{thread:(" + NAME + ")\\}=(" + NAME + ")\\.params," +
  "(" + NAME + ")=(this|" + NAME + ")\\.upsertConversationFromThread\\(\\1\\);";

const UNARCHIVED_PATTERN =
  "case`thread/unarchived`:\\{let\\{threadId:(" + NAME + ")\\}=(" + NAME + ")\\.params;";

const ANCHOR_CREATE = "throw Error(`Durable side conversations must start on a local host`);";
const REPLACEMENT_CREATE = ANCHOR_CREATE + "await globalThis.__cxpAutoRoute?.();";

export default {
  id: "090-auto-routing-core",
  description: "Auto-select best account on new thread creation and learn thread ownership",
  glob: "webview/assets/app-initial-*.js",
  marker: MARKER,
  apply(source) {
    const started = matchOnce(source, STARTED_PATTERN, "thread/started notification handler");
    const unarchived = matchOnce(source, UNARCHIVED_PATTERN, "thread/unarchived notification handler");
    matchOnce(source, ANCHOR_CREATE.replace(/[`()${}]/g, "\\$&"), "createConversation dispatch guard");

    const [startedText, thread, startedParams, conversation, receiver] = started;
    const startedReplacement =
      "case`thread/started`:{let{thread:" + thread + "}=" + startedParams + ".params;" +
      "globalThis.__cxpLearnThread?.(" + thread + "?.id);" +
      "let " + conversation + "=" + receiver + ".upsertConversationFromThread(" + thread + ");";

    const [unarchivedText, threadId] = unarchived;
    const unarchivedReplacement =
      unarchivedText + "globalThis.__cxpLearnThread?.(" + threadId + ");";

    let patched = replaceOnce(source, startedText, startedReplacement);
    patched = replaceOnce(patched, unarchivedText, unarchivedReplacement);
    patched = replaceOnce(patched, ANCHOR_CREATE, REPLACEMENT_CREATE);

    return `${helpers}\n${patched}`;
  }
};
