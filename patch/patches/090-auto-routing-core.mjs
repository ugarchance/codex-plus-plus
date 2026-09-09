import { matchOnce, replaceOnce } from "../lib/anchor.mjs";
import { functionAt } from "../lib/ast.mjs";

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
  `  globalThis.__cxpLearnThread = async (_threadId, _model, _provider) => {`,
  `    if (_model?.startsWith('cxp/') || _provider === 'cxp-external') return;`,
  `    try {`,
  `      if (await globalThis.__cxpProviderCall?.('route', _threadId)) return;`,
  `      const _api = globalThis.__codexpp;`,
  `      if (!_api || !_threadId) return;`,
  `      const _view = _api.accountsSync?.();`,
  `      const _activeId = _view?.defaultAccountId ?? _view?.activeAccountId;`,
  `      if (_activeId) {`,
  `        _api.learnThreadOwner?.(_threadId, _activeId);`,
  `      }`,
  `    } catch {}`,
  `  };`,
  `  globalThis.__cxpAutoRoute = async (_model) => {`,
  `    if (_model?.startsWith('cxp/')) return null;`,
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
const UNARCHIVED_DIRECT_PATTERN =
  "case`thread/unarchived`:(" + NAME + ")\\.handleThreadUnarchived\\((?:" + NAME +
  "\\()?(" + NAME + ")\\.params\\.threadId";


export default {
  id: "090-auto-routing-core",
  description: "Auto-select best account on new thread creation and learn thread ownership",
  glob: "webview/assets/app-initial-*.js",
  marker: MARKER,
  apply(source) {
    const started = matchOnce(source, STARTED_PATTERN, "thread/started notification handler");
    const optionalMatch = (pattern, label) => {
      const count = [...source.matchAll(new RegExp(pattern, "g"))].length;
      return count === 0 ? null : matchOnce(source, pattern, label);
    };
    const destructuredUnarchived = optionalMatch(
      UNARCHIVED_PATTERN,
      "thread/unarchived destructured notification handler"
    );
    const directUnarchived = optionalMatch(
      UNARCHIVED_DIRECT_PATTERN,
      "thread/unarchived direct notification handler"
    );
    if (Boolean(destructuredUnarchived) === Boolean(directUnarchived)) {
      throw new Error("thread/unarchived handler shape was not uniquely identified");
    }
    const unarchived = destructuredUnarchived ?? directUnarchived;
    matchOnce(source, ANCHOR_CREATE.replace(/[`()${}]/g, "\\$&"), "createConversation dispatch guard");

    const [startedText, thread, startedParams, conversation, receiver] = started;
    const startedReplacement =
      "case`thread/started`:{let{thread:" + thread + "}=" + startedParams + ".params;" +
      "globalThis.__cxpLearnThread?.(" + thread + "?.id," + thread + "?.model," + thread + "?.modelProvider);" +
      "let " + conversation + "=" + receiver + ".upsertConversationFromThread(" + thread + ");";

    const [unarchivedText] = unarchived;
    let unarchivedReplacement;
    if (destructuredUnarchived) {
      const threadId = unarchived[1];
      unarchivedReplacement =
        unarchivedText + "globalThis.__cxpLearnThread?.(" + threadId + ");";
    } else {
      const threadIdParams = unarchived[2];
      const colon = unarchivedText.indexOf(":");
      unarchivedReplacement =
        unarchivedText.slice(0, colon + 1) +
        "globalThis.__cxpLearnThread?.(" + threadIdParams + ".params.threadId);" +
        unarchivedText.slice(colon + 1);
    }

    let patched = replaceOnce(source, startedText, startedReplacement);
    patched = replaceOnce(patched, unarchivedText, unarchivedReplacement);
    const createFn = functionAt(source, "Durable side conversations must start on a local host");
    const [, collaboration] = matchOnce(source.slice(createFn.start, createFn.end), `collaborationMode:(${NAME})`, "thread creation model settings");
    patched = replaceOnce(patched, ANCHOR_CREATE, ANCHOR_CREATE + `await globalThis.__cxpAutoRoute?.(${collaboration}?.settings?.model);`);

    return `${helpers}\n${patched}`;
  }
};
