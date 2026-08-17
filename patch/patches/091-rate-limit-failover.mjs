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
    `/*_cxpPoolStats:start*/`,
    `function _cxpPoolStats(accounts, now) {`,
    `  const _list = Array.isArray(accounts) ? accounts : [];`,
    `  const rows = _list.map((_a) => ({`,
    `    id: _a?.id,`,
    `    label: _a?.label ?? _a?.email ?? _a?.id,`,
    `    usedPercent: typeof _a?.usedPercent === "number" ? _a.usedPercent : null,`,
    `    resetAt: typeof _a?.resetAt === "number" ? _a.resetAt : null`,
    `  }));`,
    `  const known = rows.filter((_r) => typeof _r.usedPercent === "number");`,
    `  const avgRemainingPct = known.length > 0`,
    `    ? 100 - (known.reduce((_s, _r) => _s + _r.usedPercent, 0) / known.length)`,
    `    : null;`,
    `  const allKnownExhausted = known.length > 0 && known.every((_r) => _r.usedPercent >= 100);`,
    `  const resets = rows.map((_r) => _r.resetAt).filter((_v) => typeof _v === "number");`,
    `  const earliestResetAt = resets.length > 0 ? Math.min(...resets) : null;`,
    `  return {`,
    `    rows,`,
    `    known,`,
    `    avgRemainingPct,`,
    `    allKnownExhausted,`,
    `    earliestResetAt`,
    `  };`,
    `}`,
    `/*_cxpPoolStats:end*/`,
    ``,
    `function ${FAILOVER_CARD}(_p) {`,
    `  const _tones = [\`--color-chart-green\`, \`--color-chart-blue\`, \`--color-chart-yellow\`, \`--color-chart-red\`, \`--color-chart-orange\`];`,
    `  const _api = globalThis.__codexpp;`,
    `  const [_view] = (0, ${react}.useState)(() => {`,
    `    try { return _api?.accountsSync?.() ?? null; } catch { return null; }`,
    `  });`,
    `  const [_routing] = (0, ${react}.useState)(() => {`,
    `    try { return _api?.routingView?.() ?? null; } catch { return null; }`,
    `  });`,
    `  const [_suggest, _setSuggest] = (0, ${react}.useState)(null);`,
    `  const [_busy, _setBusy] = (0, ${react}.useState)(!1);`,
    `  const [_credits, _setCredits] = (0, ${react}.useState)(null);`,
    ``,
    `  (0, ${react}.useEffect)(() => {`,
    `    let _alive = !0;`,
    `    Promise.resolve(_api?.routingSuggest?.()).then((_res) => {`,
    `      if (_alive && _res) _setSuggest(_res);`,
    `    }).catch(() => {});`,
    `    return () => { _alive = !1; };`,
    `  }, []);`,
    ``,
    `  (0, ${react}.useEffect)(() => {`,
    `    let _alive = !0;`,
    `    const _activeId = _view?.activeAccountId;`,
    `    if (_activeId && globalThis.__cxpResets?.credits) {`,
    `      Promise.resolve(globalThis.__cxpResets.credits(_activeId)).then((_res) => {`,
    `        if (_alive && _res?.ok && typeof _res?.data?.available_count === "number" && _res.data.available_count > 0) {`,
    `          _setCredits(_res.data.available_count);`,
    `        }`,
    `      }).catch(() => {});`,
    `    }`,
    `    return () => { _alive = !1; };`,
    `  }, [_view?.activeAccountId]);`,
    ``,
    `  const _activeId = _view?.activeAccountId;`,
    `  const _accounts = _view?.accounts ?? [];`,
    `  const _other = _suggest?.account && _suggest.account.id !== _activeId ? _suggest.account : null;`,
    `  const _stats = _cxpPoolStats(_accounts, Date.now());`,
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
    `  const _isAuto = Boolean(_routing?.autoRoute);`,
    `  const _title = _isAuto ? \`Tüm aboneliklerin kotası dolu\` : \`Otomatik yönlendirme kapalı\`;`,
    `  const _subtitle = _isAuto`,
    `    ? (_stats.earliestResetAt != null`,
    `        ? (\`En erken kota yenileme: \` + new Intl.DateTimeFormat(\`tr-TR\`, { weekday: \`long\`, hour: \`2-digit\`, minute: \`2-digit\` }).format(new Date(_stats.earliestResetAt)))`,
    `        : \`Reset zamanı bilinmiyor.\`)`,
    `    : \`Hesap menüsünden açın; kota dolunca otomatik geçiş yapılsın.\`;`,
    ``,
    `  const _rows = _stats.rows.map((_r, _i) => {`,
    `    const _tone = _tones[_i % _tones.length];`,
    `    const _initial = (_r.label ?? _r.id ?? \`?\`).trim().slice(0, 1).toUpperCase();`,
    `    const _resetStr = _r.resetAt != null`,
    `      ? new Intl.DateTimeFormat(\`tr-TR\`, { hour: \`2-digit\`, minute: \`2-digit\` }).format(new Date(_r.resetAt))`,
    `      : null;`,
    `    return (0, ${jsx}.jsxs)(\`div\`, {`,
    `      className: \`flex items-center justify-between gap-2 py-0.5\`,`,
    `      children: [`,
    `        (0, ${jsx}.jsxs)(\`div\`, {`,
    `          className: \`flex items-center gap-1.5 min-w-0\`,`,
    `          children: [`,
    `            (0, ${jsx}.jsx)(\`span\`, {`,
    `              className: \`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-medium leading-none\`,`,
    `              style: {`,
    `                backgroundColor: \`color-mix(in srgb, var(\` + _tone + \`, #8a8a8a) 20%, transparent)\`,`,
    `                color: \`var(\` + _tone + \`, #b4b4b4)\``,
    `              },`,
    `              children: _initial`,
    `            }),`,
    `            (0, ${jsx}.jsxs)(\`div\`, {`,
    `              className: \`flex flex-col min-w-0 leading-tight\`,`,
    `              children: [`,
    `                (0, ${jsx}.jsx)(\`span\`, {`,
    `                  className: \`truncate font-medium text-codex-primary\`,`,
    `                  children: _r.label`,
    `                }),`,
    `                _resetStr != null ? (0, ${jsx}.jsx)(\`span\`, {`,
    `                  className: \`text-[10px] text-codex-description\`,`,
    `                  children: _resetStr`,
    `                }) : null`,
    `              ]`,
    `            })`,
    `          ]`,
    `        }),`,
    `        (0, ${jsx}.jsx)(\`span\`, {`,
    `          className: \`shrink-0 font-medium text-codex-description\`,`,
    `          children: _r.usedPercent != null ? (\`%\` + _r.usedPercent) : \`—\``,
    `        })`,
    `      ]`,
    `    }, _r.id ?? _i);`,
    `  });`,
    ``,
    `  const _creditNode = typeof _credits === "number" && _credits > 0 ? (`,
    `    (0, ${jsx}.jsx)(\`div\`, {`,
    `      className: \`text-[11px] text-codex-description pt-1\`,`,
    `      children: _credits + \` reset kredisiyle kota açılabilir.\``,
    `    })`,
    `  ) : null;`,
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
    `          children: _busy ? \`Geçiliyor...\` : (\`Tek tıkla \` + (_other.label ?? \`hesaba\`) + \` geç\`)`,
    `        })`,
    `      ]`,
    `    })`,
    `  ) : (`,
    `    (0, ${jsx}.jsxs)(\`div\`, {`,
    `      className: \`mt-2 flex flex-col gap-2 rounded bg-codex-surface-secondary p-2 text-xs w-full\`,`,
    `      children: [`,
    `        (0, ${jsx}.jsxs)(\`div\`, {`,
    `          className: \`flex flex-col gap-0.5\`,`,
    `          children: [`,
    `            (0, ${jsx}.jsx)(\`span\`, {`,
    `              className: \`font-medium text-codex-primary\`,`,
    `              children: _title`,
    `            }),`,
    `            (0, ${jsx}.jsx)(\`span\`, {`,
    `              className: \`text-codex-description\`,`,
    `              children: _subtitle`,
    `            })`,
    `          ]`,
    `        }),`,
    `        _rows.length > 0 ? (0, ${jsx}.jsx)(\`div\`, {`,
    `          className: \`flex flex-col gap-1 pt-1\`,`,
    `          children: _rows`,
    `        }) : null,`,
    `        _creditNode`,
    `      ]`,
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

export function __test_failoverCode(jsx, react) {
  return failoverBlock({ jsx: jsx ?? "jsx", react: react ?? "React" });
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
