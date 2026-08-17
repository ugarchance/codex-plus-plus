import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

/**
 * Patch 091: Rate Limit Failover & Ineligibility Marking
 *
 * Discovery notes (docs/routing-anchors.md):
 * - Surface 2: Turn limit/quota banner component (Z0s) and error notification listener (dpr).
 * - When rate limit is reached, offer one-click switch to next best eligible account.
 * - If no other eligible account exists, show aggregated quota warning and reset timing.
 * - Mark current account ineligible upon receiving usageLimitExceeded error.
 */

const NAME = "[A-Za-z_$][\\w$]*";
const MARKER = "_cxpRateLimitFailover";
const FAILOVER_CARD = "_cxpFailoverCard";

function reactNamespace(source) {
  const hooksPattern = `\\(0,(${NAME})\\.useState\\)`;
  for (const match of source.matchAll(new RegExp(hooksPattern, "g"))) {
    const ns = match[1];
    if (source.includes(`(0,${ns}.useEffect)`)) return ns;
  }
  throw new Error("react namespace not found");
}

function failoverBlock({ jsx, react }) {
  return [
    `function ${FAILOVER_CARD}(_p) {`,
    `  const _api = globalThis.__codexpp;`,
    `  const [_view, _setView] = (0, ${react}.useState)(() => {`,
    `    try { return _api?.accountsSync?.() ?? null; } catch { return null; }`,
    `  });`,
    `  const [_routing, _setRouting] = (0, ${react}.useState)(() => {`,
    `    try { return _api?.routingView?.() ?? null; } catch { return null; }`,
    `  });`,
    `  const [_suggest, _setSuggest] = (0, ${react}.useState)(null);`,
    `  const [_busy, _setBusy] = (0, ${react}.useState)(!1);`,
    ``,
    `  (0, ${react}.useEffect)(() => {`,
    `    let _alive = !0;`,
    `    Promise.resolve(_api?.routingSuggest?.()).then((_res) => {`,
    `      if (_alive && _res) _setSuggest(_res);`,
    `    }).catch(() => {});`,
    `    return () => { _alive = !1; };`,
    `  }, []);`,
    ``,
    `  const _activeId = _view?.activeAccountId;`,
    `  const _accounts = _view?.accounts ?? [];`,
    `  const _other = _suggest?.account && _suggest.account.id !== _activeId ? _suggest.account : null;`,
    `  const _knownResets = _accounts.map((_a) => _a.resetAt).filter(Boolean).sort((_a, _b) => _a - _b);`,
    `  const _nextResetStr = _knownResets[0] ? new Date(_knownResets[0]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;`,
    ``,
    `  const _onSwitch = async () => {`,
    `    if (!_other || _busy) return;`,
    `    _setBusy(!0);`,
    `    try {`,
    `      await globalThis.__cxpActivate?.(_other.id);`,
    `    } finally {`,
    `      _setBusy(!1);`,
    `    }`,
    `  };`,
    ``,
    `  const _action = _other ? (`,
    `    (0, ${jsx}.jsxs)(\`div\`, {`,
    `      className: \`mt-2 flex items-center justify-between rounded bg-codex-surface-secondary p-2 text-xs\`,`,
    `      children: [`,
    `        (0, ${jsx}.jsxs)(\`div\`, {`,
    `          className: \`flex flex-col gap-0.5\`,`,
    `          children: [`,
    `            (0, ${jsx}.jsxs)(\`span\`, {`,
    `              className: \`font-medium text-codex-primary\`,`,
    `              children: [\`Uygun hesap: \`, _other.label ?? _other.email ?? _other.id]`,
    `            }),`,
    `            (0, ${jsx}.jsx)(\`span\`, {`,
    `              className: \`text-codex-description\`,`,
    `              children: \`Kota asildi. Otomatik rotasyonla bu hesaba gecebilirsiniz.\``,
    `            })`,
    `          ]`,
    `        }),`,
    `        (0, ${jsx}.jsx)(\`button\`, {`,
    `          className: \`ml-2 inline-flex items-center rounded bg-primary px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 transition-opacity\`,`,
    `          onClick: _onSwitch,`,
    `          disabled: _busy,`,
    `          children: _busy ? \`Geçiliyor...\` : \`Tek tıkla \${_other.label ?? "hesaba"} geç\``,
    `        })`,
    `      ]`,
    `    })`,
    `  ) : (`,
    `    (0, ${jsx}.jsx)(\`div\`, {`,
    `      className: \`mt-2 rounded bg-codex-surface-secondary p-2 text-xs text-codex-description\`,`,
    `      children: _nextResetStr ? \`Kullanilabilir baska hesap yok. Siradaki reset: \${_nextResetStr}\` : \`Kullanilabilir baska uygun hesap bulunamadi.\``,
    `    })`,
    `  );`,
    ``,
    `  return (0, ${jsx}.jsxs)(\`div\`, {`,
    `    className: \`flex flex-col w-full\`,`,
    `    children: [_p.original, _action]`,
    `  });`,
    `}`
  ].join("\n");
}

const helpers = [
  `;(()=>{`,
  `  const ${MARKER} = true;`,
  `  globalThis.__cxpMarkActiveIneligible = (_reason) => {`,
  `    try {`,
  `      const _api = globalThis.__codexpp;`,
  `      const _view = _api?.accountsSync?.();`,
  `      const _activeId = _view?.activeAccountId;`,
  `      if (_activeId) {`,
  `        _api?.markIneligible?.(_activeId, _reason ?? "usageLimitExceeded");`,
  `      }`,
  `    } catch {}`,
  `  };`,
  `})();`
].join("\n");

const DPR_ANCHOR = "t.params.error.codexErrorInfo===`usageLimitExceeded`&&";
// Self-balanced replacement: (side-effect, original-condition) && ...
// The comma expression evaluates the marker call, then yields the original
// condition unchanged, so downstream semantics are identical and no
// downstream closing paren is required.
const DPR_REPLACEMENT =
  "t.params.error.codexErrorInfo===`usageLimitExceeded`&&" +
  "(globalThis.__cxpMarkActiveIneligible?.(`usageLimitExceeded`)," +
  "t.params.error.codexErrorInfo===`usageLimitExceeded`)&&";

const Z0S_RETURN_PATTERN = `t\\[137\\]=(${NAME})\\):\\1=t\\[137\\],\\1\\}function (${NAME})\\((${NAME})\\)\\{let ${NAME}=\\(0,${NAME}\\.c\\)\\(18\\),`;

export default {
  id: "091-rate-limit-failover",
  description: "One-click switch to eligible account in rate limit banner and mark account ineligible",
  glob: "webview/assets/app-initial-*.js",
  marker: MARKER,
  apply(source) {
    matchOnce(source, DPR_ANCHOR.replace(/[`()${}]/g, "\\$&"), "dpr usageLimitExceeded listener");
    const z0sMatch = matchOnce(source, Z0S_RETURN_PATTERN, "Z0s return statement");

    const returnVar = z0sMatch[1];
    const z0sIndex = z0sMatch.index;

    // Scan window around Z0s to extract JSX namespace
    const windowStart = Math.max(0, z0sIndex - 5000);
    const windowSource = source.slice(windowStart, z0sIndex);

    const [, jsx] = matchOnce(windowSource, `\\(0,(${NAME})\\.jsx\\)\\((${NAME}),\\{Icon:`, "JSX namespace in banner window");
    const react = reactNamespace(source);

    const failoverCode = failoverBlock({ jsx, react });

    // The matched region spans the memoized return expression of the
    // banner component and the head of the next function definition:
    //   t[137]=<v>):<v>=t[137],<v>}function Next(e){...
    // The memo slot caches the raw element in both branches; the comma tail
    // yields the rendered value. Wrap that final value so both branches are
    // covered, and splice the helper function in at the statement boundary
    // between the two function definitions (never inside an expression).
    const full = z0sMatch[0];
    const nextFnOffset = full.lastIndexOf("function ");
    if (nextFnOffset === -1) throw new Error("next function boundary not found");
    const headPart = full.slice(0, nextFnOffset);
    const nextFnPart = full.slice(nextFnOffset);

    const tailToken = `,${returnVar}}`;
    const tailIndex = headPart.lastIndexOf(tailToken);
    if (tailIndex === -1) throw new Error("memo tail not found");
    const headWrapped =
      headPart.slice(0, tailIndex) +
      `,(0,${jsx}.jsx)(${FAILOVER_CARD},{original:${returnVar}})}`;

    let patched =
      source.slice(0, z0sIndex) +
      headWrapped +
      "\n" +
      failoverCode +
      "\n" +
      nextFnPart +
      source.slice(z0sIndex + z0sMatch[0].length);

    patched = replaceOnce(patched, DPR_ANCHOR, DPR_REPLACEMENT);

    return `${helpers}\n${patched}`;
  }
};
