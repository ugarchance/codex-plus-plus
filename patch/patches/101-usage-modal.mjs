/**
 * 101-usage-modal.mjs
 *
 * KESIF VE CAPA SECIMI:
 * 1. AST taramasinda `/wham/rate-limit-reset-credits` ve i18n anahtarlari
 *    (`codex.rateLimitResetPromptModal.usageTrackingHeading`,
 *     `codex.rateLimitResetPromptModal.closeUsageModal`,
 *     `codex.rateLimitResetModal.error`) arandi.
 * 2. Kullanim/rate-limit modalinin govdesini olusturan bilesen tespit edildi:
 *    Prop destructuring imzasi tekil ve kararlidir:
 *    `{availableCount, availableResetCredits, defaultResetCreditsOpen, errorMessage, isLoadingResetCredits, isResetting, onAddCredits, onClose, onResetCredit, onUpgradePlan, usageWindows}`.
 * 3. Modal icerik dizilimi `children:[_e,Ce,we,Te]` yapisindadir:
 *    - `_e`: Baslik ve kapat butonu alani
 *    - `Ce`: Kullanim limit cubuklari (`xe`) ve reset kredileri akordeonu (`Se`)
 *    - `we`: Ayirici ve hata mesaji
 *    - `Te`: Plan yukseltme / kredi ekleme butonlari
 * 4. Secilen Capalar:
 *    - `HEAD_PATTERN`: Prop destructuring imzasina dayali regex (minified olmayan anlamli prop adlari).
 *    - `JSX_PATTERN`: Modal icerik kapsayicisi `(0, ${NAME}.jsxs)(${NAME}, {className: `overflow-y-auto` uzerinden JSX namespace tespiti.
 *    - `CHILDREN_PATTERN`: Modal icerik siralamasindaki 4 elemanli `children:[...]` dizisi.
 *    - `HOOKS_PATTERN`: React `useState` ve `useEffect` namespace tespiti.
 */

import { matchOnce } from "../lib/anchor.mjs";

const NAME = "[A-Za-z_$][\\w$]*";
const MODAL_BLOCK = "_cxpUsageModalSelector";
const MODAL_AVATAR = "_cxpUsageModalAvatar";

const HEAD_PATTERN =
  `function (${NAME})\\((${NAME})\\)\\{let (${NAME})=\\(0,${NAME}\\.c\\)\\(\\d+\\),` +
  "\\{availableCount:(" + NAME +
  "),availableResetCredits:(" + NAME +
  "),defaultResetCreditsOpen:(" + NAME +
  "),errorMessage:(" + NAME +
  "),isLoadingResetCredits:(" + NAME +
  "),isResetting:(" + NAME +
  "),onAddCredits:(" + NAME +
  "),onClose:(" + NAME +
  "),onResetCredit:(" + NAME +
  "),onUpgradePlan:(" + NAME +
  "),usageWindows:(" + NAME +
  ")\\}=\\2";

const JSX_PATTERN = `\\(0,(${NAME})\\.jsxs\\)\\(${NAME},\\{className:\`overflow-y-auto`;
const CHILDREN_PATTERN = `children:\\[(${NAME}),(${NAME}),(${NAME}),(${NAME})\\]`;
const HOOKS_PATTERN = `\\(0,(${NAME})\\.useState\\)`;

function reactNamespace(source) {
  for (const match of source.matchAll(new RegExp(HOOKS_PATTERN, "g"))) {
    const ns = match[1];
    if (source.includes(`(0,${ns}.useEffect)`)) return ns;
  }
  throw new Error("react namespace not found");
}

function helpers({ jsx, react }) {
  return [
    "const _cxpTones=[\`--color-chart-green\`,\`--color-chart-blue\`,\`--color-chart-yellow\`,\`--color-chart-red\`,\`--color-chart-orange\`];",
    "function _cxpModalTitle(_a){const _l=_a.label??_a.email??_a.id;return _a.email&&_l===_a.email?_l.split(`@`)[0]:_l}",
    `function ${MODAL_AVATAR}(_p){`,
    "const _a=_p.account,_i=_p.index;",
    `if(_a.avatarUrl)return(0,${jsx}.jsx)(\`img\`,{src:_a.avatarUrl,alt:\`\`,className:\`icon-xs rounded-full object-cover\`});`,
    "const _tone=_cxpTones[_i%_cxpTones.length];",
    "const _text=_cxpModalTitle(_a).trim().slice(0,1).toUpperCase();",
    `return(0,${jsx}.jsx)(\`span\`,{`,
    "className:`icon-xs flex items-center justify-center rounded-full text-[9px] leading-none font-semibold`,",
    "style:{backgroundColor:`color-mix(in srgb, var(${_tone}, #8a8a8a) 20%, transparent)`,color:`var(${_tone}, #b4b4b4)`},",
    "children:_text})}",
    `function ${MODAL_BLOCK}(_p){`,
    "const _accounts=_p.accounts??[];",
    "if(_accounts.length<=1)return null;",
    `return(0,${jsx}.jsx)(\`div\`,{`,
    "className:`flex items-center gap-1.5 overflow-x-auto pb-1 pt-2 -mx-1 px-1 scrollbar-none`,",
    "children:_accounts.map((_a,_i)=>{",
    "const _selected=_a.id===_p.selectedId;",
    "const _cred=_p.creditsMap?.[_a.id];",
    "const _loading=_p.loadingMap?.[_a.id];",
    "const _count=_cred?.available_count??null;",
    "const _countLabel=_loading?`...`:(_count!=null?`${_count}`:`—`);",
    `return(0,${jsx}.jsxs)(\`button\`,{`,
    "key:`cxp-acc-sel-`+_a.id,type:`button`,onClick:()=>_p.onSelect(_a.id),",
    "className:`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border outline-none cursor-pointer shrink-0`,",
    "style:{",
    "borderColor:_selected?`var(--color-border-selected, currentColor)`:`var(--color-border-subtle, rgba(128,128,128,0.2))`,",
    "backgroundColor:_selected?`rgba(128, 128, 128, 0.12)`:`transparent`,",
    "color:_selected?`var(--color-text-default)`:`var(--color-text-secondary)`",
    "},",
    `children:[`,
    `(0,${jsx}.jsx)(${MODAL_AVATAR},{account:_a,index:_i}),`,
    `(0,${jsx}.jsx)(\`span\`,{className:\`truncate max-w-[120px]\`,children:_cxpModalTitle(_a)}),`,
    `(0,${jsx}.jsx)(\`span\`,{`,
    "className:`rounded-full px-1.5 py-0.5 text-[10px] leading-none font-semibold`,",
    "style:{",
    "backgroundColor:_count&&_count>0?`rgba(34, 197, 94, 0.2)`:`rgba(128, 128, 128, 0.1)`,",
    "color:_count&&_count>0?`rgb(34, 197, 94)`:`var(--color-text-tertiary)`",
    "},",
    "children:_countLabel+` resets`",
    "})",
    `]}`,
    ")})})}"
  ].join("\n");
}

export default {
  id: "101-usage-modal",
  description: "Per-account reset credit selector and consumption in the usage limits modal",
  glob: "webview/assets/app-initial-*.js",
  marker: MODAL_BLOCK,
  apply(source) {
    const head = matchOnce(source, HEAD_PATTERN, "usage modal component");
    const [
      fullHeadMatch,
      component,
      argVar,
      tVar,
      countVar,
      creditsVar,
      defaultOpenVar,
      errorMsgVar,
      loadingVar,
      resettingVar,
      addCreditsVar,
      closeVar,
      resetFnVar,
      upgradePlanVar,
      usageWindowsVar
    ] = head;

    const start = head.index;
    const body = source.slice(start, start + 8500);

    const [, jsx] = matchOnce(body, JSX_PATTERN, "jsx namespace");
    const children = matchOnce(body, CHILDREN_PATTERN, "modal children array");
    const react = reactNamespace(source);

    const slots = children.slice(1);
    const headerSlot = slots[0];
    const restSlots = slots.slice(1);

    const injectionHead = [
      `const _cxpApi=globalThis.__codexpp;`,
      `const _cxpResetsApi=globalThis.__cxpResets;`,
      `const[_cxpView,_cxpSetView]=(0,${react}.useState)(()=>{try{return _cxpApi?.accountsSync?.()??null}catch{return null}});`,
      `const _cxpAccounts=_cxpView?.accounts??[];`,
      `const _cxpActiveId=_cxpView?.activeAccountId??(_cxpAccounts[0]?.id??null);`,
      `const[_cxpSelectedId,_cxpSetSelectedId]=(0,${react}.useState)(_cxpActiveId);`,
      `const[_cxpCreditsMap,_cxpSetCreditsMap]=(0,${react}.useState)({});`,
      `const[_cxpLoadingMap,_cxpSetLoadingMap]=(0,${react}.useState)({});`,
      `(0,${react}.useEffect)(()=>{`,
      `if(!_cxpResetsApi||_cxpAccounts.length===0)return;`,
      `let _alive=!0;`,
      `for(const _acc of _cxpAccounts){`,
      `if(!_acc.id)continue;`,
      `_cxpSetLoadingMap(_p=>({..._p,[_acc.id]:!0}));`,
      `Promise.resolve(_cxpResetsApi.credits(_acc.id)).then(_res=>{`,
      `if(!_alive)return;`,
      `_cxpSetLoadingMap(_p=>({..._p,[_acc.id]:!1}));`,
      `if(_res?.ok&&_res.data){_cxpSetCreditsMap(_p=>({..._p,[_acc.id]:_res.data}))}`,
      `}).catch(()=>{if(_alive)_cxpSetLoadingMap(_p=>({..._p,[_acc.id]:!1}))})`,
      `}`,
      `return()=>{_alive=!1}},[_cxpView]);`,
      `const _cxpSelectedCredits=_cxpSelectedId?_cxpCreditsMap[_cxpSelectedId]:null;`,
      `const _cxpIsSelectedLoading=_cxpSelectedId?Boolean(_cxpLoadingMap[_cxpSelectedId]):!1;`,
      `const _cxpEffCount=(_cxpSelectedCredits&&typeof _cxpSelectedCredits.available_count===\`number\`)?_cxpSelectedCredits.available_count:(_cxpSelectedId===_cxpActiveId?${countVar}:0);`,
      `const _cxpEffCredits=(_cxpSelectedCredits&&Array.isArray(_cxpSelectedCredits.credits))?_cxpSelectedCredits.credits.filter(_c=>_c&&(_c.redeemed_at==null&&_c.redeemed_date==null)):(_cxpSelectedId===_cxpActiveId?${creditsVar}:null);`,
      `const _cxpEffLoading=_cxpIsSelectedLoading||(_cxpSelectedId===_cxpActiveId?${loadingVar}:!1);`,
      `const _cxpOnResetCredit=async(_creditId,_count)=>{`,
      `if(!_cxpResetsApi||!_cxpSelectedId){return ${resetFnVar}(_creditId,_count)}`,
      `const _reqId=(typeof crypto!==\`undefined\`&&crypto.randomUUID)?crypto.randomUUID():(\`req-\`+Date.now()+\`-\`+Math.random().toString(36).slice(2,9));`,
      `const _res=await _cxpResetsApi.consume(_cxpSelectedId,_creditId??\`automatic\`,_reqId);`,
      `if(!_res?.ok){return{status:\`failed\`,error:_res?.error}}`,
      `const _fresh=await _cxpResetsApi.credits(_cxpSelectedId,!0);`,
      `if(_fresh?.ok&&_fresh.data){_cxpSetCreditsMap(_p=>({..._p,[_cxpSelectedId]:_fresh.data}))}`,
      `const _rem=_fresh?.data?.available_count??Math.max(0,(_count??1)-1);`,
      `return{status:\`completed\`,creditId:_creditId,remainingCount:_rem}`,
      `};`,
      `${countVar}=_cxpEffCount;${creditsVar}=_cxpEffCredits;${loadingVar}=_cxpEffLoading;${resetFnVar}=_cxpOnResetCredit;`
    ].join("");

    const newChildren = `children:[${headerSlot},(0,${jsx}.jsx)(${MODAL_BLOCK},{accounts:_cxpAccounts,selectedId:_cxpSelectedId,onSelect:_cxpSetSelectedId,creditsMap:_cxpCreditsMap,loadingMap:_cxpLoadingMap}),${restSlots.join(",")}]`;

    // 1. Prepend helper definitions before component definition
    // 2. Inject state and overrides right after prop destructuring
    // 3. Inject selector component into modal children array

    const helperCode = helpers({ jsx, react }) + "\n";
    const headEnd = start + fullHeadMatch.length;
    const childrenOffset = start + children.index;

    const modified =
      source.slice(0, start) +
      helperCode +
      source.slice(start, headEnd) +
      ";" +
      injectionHead +
      source.slice(headEnd, childrenOffset) +
      newChildren +
      source.slice(childrenOffset + children[0].length);

    return modified;
  }
};
