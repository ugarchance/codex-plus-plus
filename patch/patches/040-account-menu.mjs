import { matchOnce } from "../lib/anchor.mjs";

const NAME = "[A-Za-z_$][\\w$]*";
const BLOCK = "_cxpAccountBlock";
const PLUS = "_cxpPlusIcon";
const CHECK = "_cxpCheckIcon";
const GAUGE = "_cxpGaugeIcon";
const EXIT = "_cxpExitIcon";
const ROUTE = "_cxpRouteIcon";
const AUTOROW = "_cxpAutoRow";
const VIEWROW = "_cxpViewRow";
const ALERT = "_cxpAlertIcon";
const AVATAR = "_cxpAvatar";
const ROW = "_cxpAccountRow";

const esc = (name) => name.replace(/\$/g, "\\$");

const HEAD_PATTERN =
  `function (${NAME})\\((${NAME})\\)\\{let ${NAME}=\\(0,${NAME}\\.c\\)\\(\\d+\\),` +
  "\\{accountIcon:" + NAME +
  ",accountLabel:" + NAME +
  ",additionalItems:" + NAME +
  ",displayName:" + NAME +
  ",identityItems:" + NAME +
  ",isPetVisible:" + NAME +
  ",onCopyUserId:" + NAME +
  ",onLogOut:" + NAME +
  ",onOpenProfile:" + NAME +
  ",onOpenSettings:" + NAME +
  ",onOpenWorkspaceSettings:" + NAME +
  ",onTogglePet:" + NAME +
  ",settingsShortcut:" + NAME +
  `,usageItems:(${NAME})` +
  ",workspaceSettingsRightIcon:" + NAME +
  "\\}=\\2";

const CALL_PATTERN = (component) =>
  `\\(0,${NAME}\\.jsx\\)\\(${esc(component)},\\{accountIcon:${NAME},accountLabel:${NAME}` +
  `,additionalItems:${NAME},displayName:${NAME},identityItems:${NAME},isPetVisible:${NAME}` +
  `,onCopyUserId:${NAME},onLogOut:(${NAME}),`;

const MENU_NS_PATTERN = `\\(0,(${NAME})\\.jsx\\)\\((${NAME})\\.ItemIcon,`;

const ITEM_PATTERN = (jsx) =>
  `\\(0,${esc(jsx)}\\.jsx\\)\\((${NAME}),\\{className:(${NAME})==null\\?\`opacity-100\`:void 0,` +
  `disabled:\\2==null,LeftIcon:${NAME},onClick:\\2,rightIcon:${NAME},children:${NAME}\\}\\)`;

const CHILDREN_PATTERN = (usage) => {
  const slot = `(${NAME})`;
  return `children:\\[${slot},${slot},${slot},${slot},${usage},${slot},${slot},${slot},${slot}\\]`;
};

const HOOKS_PATTERN = `\\(0,(${NAME})\\.useState\\)`;

function reactNamespace(source) {
  for (const match of source.matchAll(new RegExp(HOOKS_PATTERN, "g"))) {
    const ns = match[1];
    if (source.includes(`(0,${ns}.useEffect)`)) return ns;
  }
  throw new Error("react namespace not found");
}

function block({ jsx, menu, item, react }) {
  const icon = (path, vb) =>
    `function _cxpIcon(_p){` +
    `return(0,${jsx}.jsx)(\`svg\`,{className:_p.className,viewBox:\`${vb || "0 0 20 20"}\`,fill:\`none\`,` +
    `children:(0,${jsx}.jsx)(\`path\`,{d:\`${path}\`,stroke:\`currentColor\`,strokeWidth:1.5,` +
    `strokeLinecap:\`round\`,strokeLinejoin:\`round\`})})}`;

  return [
    icon("M10 4.75v10.5M4.75 10h10.5").replace("_cxpIcon", PLUS),
    icon("M4.5 10.5l3.5 3.5 7.5-8").replace("_cxpIcon", CHECK),
    icon("M10 17.25a7.25 7.25 0 1 1 7.25-7.25M10 10l3.6-3.6").replace("_cxpIcon", GAUGE),
    icon("M12.25 6.25V4.75h-7.5v10.5h7.5v-1.5M8.75 10h8.5M14.75 7.5L17.25 10l-2.5 2.5").replace("_cxpIcon", EXIT),
    icon("M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0 1 13.66-4.66L20 7M20 15a8 8 0 0 1-13.66 4.66L4 17", "0 0 24 24").replace("_cxpIcon", ROUTE),
    icon("M10 3.25L2.5 16.75h15L10 3.25zM10 8v4M10 14.5v.5").replace("_cxpIcon", ALERT),

    // Non-Radix row: clicking toggles auto-route WITHOUT closing the menu
    // (stops pointer/mouse/click so Radix never sees an item activation),
    // and shows a native tooltip explaining the control on hover.
    `function ${AUTOROW}(_p){`,
    `const[_hov,_setHov]=(0,${react}.useState)(!1);`,
    `return(0,${jsx}.jsx)(\`div\`,{`,
    `title:\`Automatic routing: new chats are assigned to the best account by plan/quota eligibility. Click to toggle; the menu stays open.\`,`,
    `onPointerDown:(e)=>e.stopPropagation(),onPointerUp:(e)=>e.stopPropagation(),`,
    `onMouseDown:(e)=>e.stopPropagation(),onMouseUp:(e)=>e.stopPropagation(),`,
    `onClick:(e)=>{e.stopPropagation();e.preventDefault();_p.onToggle();},`,
    `onMouseEnter:()=>_setHov(!0),onMouseLeave:()=>_setHov(!1),`,
    `className:\`relative mx-1 my-0.5 flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm\`,`,
    `style:{backgroundColor:_hov?\`rgba(128,128,128,0.12)\`:\`transparent\`},`,
    `children:[`,
    `(0,${jsx}.jsx)(${ROUTE},{className:\`h-4 w-4 shrink-0\`}),`,
    `(0,${jsx}.jsx)(\`span\`,{className:\`flex-1\`,children:\`Automatic routing\`}),`,
    `(0,${jsx}.jsx)(\`span\`,{className:\`whitespace-nowrap text-codex-description\`,children:_p.autoRoute?\`On\`:\`Off\`})`,
    `]},\`cxp-auto-route\`)}`,

    `function ${VIEWROW}(_p){`,
    `const _stop=(e)=>e.stopPropagation();`,
    `const _choose=(_next,e)=>{e.stopPropagation();e.preventDefault();_p.onChange(_next)};`,
    `const _button=(_value,_label)=>(0,${jsx}.jsx)(\`button\`,{type:\`button\`,[\`aria-pressed\`]:_p.value===_value,`,
    `onPointerDown:_stop,onPointerUp:_stop,onMouseDown:_stop,onMouseUp:_stop,onClick:e=>_choose(_value,e),`,
    `className:\`rounded-md border px-1.5 py-0.5 text-xs font-medium transition-colors\`,`,
    `style:{backgroundColor:_p.value===_value?\`var(--color-surface-tertiary)\`:\`transparent\`,borderColor:\`var(--color-border-subtle)\`,color:_p.value===_value?\`var(--color-text-primary)\`:\`var(--color-text-secondary)\`},children:_label});`,
    `return(0,${jsx}.jsxs)(\`div\`,{role:\`group\`,[\`aria-label\`]:\`Usage view\`,onPointerDown:_stop,onPointerUp:_stop,onMouseDown:_stop,onMouseUp:_stop,onClick:_stop,`,
    `className:\`mx-1 my-0.5 flex select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm\`,children:[`,
    `(0,${jsx}.jsx)(\`span\`,{className:\`flex-1\`,children:\`View\`}),`,
    `(0,${jsx}.jsx)(\`div\`,{className:\`flex items-center gap-1\`,children:[_button(\`cards\`,\`Cards\`),_button(\`bars\`,\`Bars\`)]})]})}`,

    `const _cxpTones=[\`--color-chart-green\`,\`--color-chart-blue\`,\`--color-chart-yellow\`,\`--color-chart-red\`,\`--color-chart-orange\`];`,
    "const _cxpViewKey=`codexpp.usageView`;",
    "const _cxpPlans={free:`Free`,plus:`Plus`,pro:`Pro`,team:`Team`,business:`Business`,enterprise:`Enterprise`};",
    "function _cxpPlan(_v){return _v?_cxpPlans[_v]??_v:null}",
    "function _cxpLeft(_v){return typeof _v===`number`?Math.max(0,Math.round(100-_v)):null}",
    "function _cxpWindowKind(_w){const _m=_w?.windowMins;if(typeof _m===`number`&&Number.isFinite(_m)){if(Math.abs(_m-300)<=5)return `fiveHour`;if(Math.abs(_m-10080)<=60)return `weekly`;}return `other`}",
    "function _cxpWindows(_a){const _raw=_a?.usageWindows;if(_raw&&typeof _raw===`object`){const _out=[];const _add=(_w,_k)=>{if(_w&&typeof _w===`object`&&(typeof _w.usedPercent===`number`||typeof _w.resetAt===`number`||typeof _w.windowMins===`number`))_out.push({kind:_k,window:_w})};_add(_raw.fiveHour,`fiveHour`);_add(_raw.weekly,`weekly`);if(Array.isArray(_raw.other))_raw.other.forEach(_w=>_add(_w,`other`));return _out}const _legacy={usedPercent:_a?.usedPercent,resetAt:_a?.resetAt,windowMins:_a?.windowMins};return typeof _legacy.usedPercent===`number`||typeof _legacy.resetAt===`number`||typeof _legacy.windowMins===`number`?[{kind:_cxpWindowKind(_legacy),window:_legacy}]:[]}",
    "function _cxpReset(_v){if(typeof _v!==`number`||!Number.isFinite(_v))return null;const _d=new Date(_v);if(Number.isNaN(_d.getTime()))return null;const _now=new Date(),_time=new Intl.DateTimeFormat(undefined,{hour:`2-digit`,minute:`2-digit`}).format(_d);if(_d.toDateString()===_now.toDateString())return _time;const _tomorrow=new Date(_now);_tomorrow.setDate(_tomorrow.getDate()+1);if(_d.toDateString()===_tomorrow.toDateString())return `Tomorrow ${_time}`;return new Intl.DateTimeFormat(undefined,{weekday:`short`,hour:`2-digit`,minute:`2-digit`}).format(_d)}",
    "function _cxpWindowLabel(_kind){if(_kind===`fiveHour`)return `5h left`;if(_kind===`weekly`)return `Weekly left`;return `Usage left`}",
    `function _cxpWindowCard(_p){`,
    `const _w=_p.window,_used=typeof _w.usedPercent===\`number\`&&Number.isFinite(_w.usedPercent)?_w.usedPercent:null,_left=_used==null?null:_cxpLeft(_used),_reset=_cxpReset(_w.resetAt),_label=_cxpWindowLabel(_p.kind);`,
    `return(0,${jsx}.jsxs)(\`div\`,{className:\`min-w-0 flex-1 rounded-md border px-2 py-1\`,style:{backgroundColor:\`var(--color-surface-tertiary)\`,borderColor:\`var(--color-border-subtle)\`},[\`aria-label\`]:_label+(_left==null?\`\`:\` \`+_left+\`%\`),children:[`,
    `(0,${jsx}.jsxs)(\`div\`,{className:\`flex items-baseline justify-between gap-2\`,children:[`,
    `(0,${jsx}.jsx)(\`span\`,{className:\`truncate text-xs font-medium text-codex-primary\`,children:_label}),`,
    `(0,${jsx}.jsx)(\`span\`,{className:\`shrink-0 text-base font-medium tabular-nums text-codex-primary\`,children:_left==null?\`—\`:_left+\`%\`})]}),`,
    `_reset?(0,${jsx}.jsx)(\`span\`,{className:\`mt-0.5 block truncate text-xs text-codex-description\`,children:_reset}):null]})}`,
    "function _cxpBarTone(_left){if(_left==null)return `--color-text-tertiary`;if(_left>=60)return `--color-chart-green`;if(_left>=25)return `--color-chart-yellow`;return `--color-chart-red`}",
    `function _cxpWindowBar(_p){`,
    `const _w=_p.window,_used=typeof _w.usedPercent===\`number\`&&Number.isFinite(_w.usedPercent)?_w.usedPercent:null,_left=_used==null?null:_cxpLeft(_used),_reset=_cxpReset(_w.resetAt),_label=_cxpWindowLabel(_p.kind),_fill=_left==null?0:Math.min(100,Math.max(0,_left)),_tone=_cxpBarTone(_left);`,
    `return(0,${jsx}.jsxs)(\`div\`,{className:\`flex flex-col gap-1\`,children:[`,
    `(0,${jsx}.jsxs)(\`div\`,{className:\`flex items-baseline justify-between gap-2 text-xs\`,children:[`,
    `(0,${jsx}.jsx)(\`span\`,{className:\`font-medium text-codex-primary\`,children:_label}),`,
    `_reset?(0,${jsx}.jsx)(\`span\`,{className:\`min-w-0 truncate text-right text-codex-description\`,children:_reset}):null]}),`,
    `(0,${jsx}.jsx)(\`div\`,{role:\`progressbar\`,[\`aria-label\`]:_label,[\`aria-valuemin\`]:0,[\`aria-valuemax\`]:100,[\`aria-valuenow\`]:_left==null?void 0:_fill,className:\`h-1 w-full overflow-hidden rounded-full\`,style:{backgroundColor:\`var(--color-border-subtle)\`},children:(0,${jsx}.jsx)(\`div\`,{className:\`h-full rounded-full transition-[width]\`,style:{width:_fill+\`%\`,backgroundColor:\`var(\${_tone})\`}})})]})}`,
    "function _cxpTitle(_a){const _l=_a.label??_a.email??_a.id;return _a.email&&_l===_a.email?_l.split(`@`)[0]:_l}",
    "let _cxpGuard=0;",
    "function _cxpBlock(_e){_e.preventDefault();_e.stopPropagation()}",

    `function ${AVATAR}(_p){`,
    "const _a=_p.account,_i=_p.index;",
    `if(_a.avatarUrl)return(0,${jsx}.jsx)(\`img\`,{src:_a.avatarUrl,alt:\`\`,className:\`icon-sm rounded-full object-cover\`});`,
    "const _tone=_cxpTones[_i%_cxpTones.length];",
    "const _text=_cxpTitle(_a).trim().slice(0,1).toUpperCase();",
    `return(0,${jsx}.jsx)(\`span\`,{`,
    "className:`icon-sm flex items-center justify-center rounded-full text-[9px] leading-none`,",
    "style:{backgroundColor:`color-mix(in srgb, var(${_tone}, #8a8a8a) 20%, transparent)`,color:`var(${_tone}, #b4b4b4)`},",
    "children:_text})}",

    `function ${ROW}(_p){`,
    `const[_hover,_setHover]=(0,${react}.useState)(!1);`,
    "const _a=_p.account,_windows=_cxpWindows(_a),_summaryEntry=_windows.find(_v=>_v.kind===`weekly`)??_windows[0]??null,_summaryWindow=_summaryEntry?.window,_left=_cxpLeft(_summaryWindow?.usedPercent??_a.usedPercent),_plan=_cxpPlan(_a.planType);",
    "const _ineligible=_a.planType===`free`||_a.planType===`go`||Boolean(_p.routing?.learnedIneligible?.[_a.id]);",
    "const _sub=_ineligible?(_a.email?`${_a.email} · Not eligible`:`Not eligible`):_a.email??null;",
    `const _exit=(0,${jsx}.jsx)(\`span\`,{role:\`button\`,title:\`Log out\`,`,
    "className:`flex items-center rounded-sm transition-opacity`,",
    "style:{opacity:_hover?1:.45},",
    "onMouseEnter:()=>_setHover(!0),onMouseLeave:()=>_setHover(!1),",
    "onPointerDown:_cxpBlock,onPointerUp:_cxpBlock,onMouseDown:_cxpBlock,onMouseUp:_cxpBlock,",
    "onClick:_e=>{_cxpBlock(_e);_cxpGuard=Date.now();_p.onSignOut()},",
    `children:(0,${jsx}.jsx)(${EXIT},{className:\`icon-xs\`})});`,
    `const _right=(0,${jsx}.jsxs)(\`span\`,{className:\`flex shrink-0 items-center gap-1.5 whitespace-nowrap text-codex-description\`,children:[`,
    "_exit,",
    `_p.active?(0,${jsx}.jsx)(${CHECK},{className:\`icon-xs\`}):null,`,
    "_p.view===`bars`?(_left==null?`—`:`${_left}%`):null]});",
    `const _windowContent=_windows.map((_v,_i)=>(0,${jsx}.jsx)(_p.view===\`bars\`?_cxpWindowBar:_cxpWindowCard,{kind:_v.kind,window:_v.window},\`cxp-window-\`+_v.kind+\`-\`+_i));`,
    `const _bars=_p.view===\`bars\`;`,
    `return(0,${jsx}.jsxs)(${item},{onClick:()=>{if(Date.now()-_cxpGuard>500)_p.onPick()},onMouseEnter:()=>_setHover(!0),onMouseLeave:()=>_setHover(!1),className:_bars?\`mx-1 border-b px-2 py-2 transition-colors\`:\`mx-1 my-1 rounded-md border px-2 py-1.5 transition-colors\`,style:{backgroundColor:_hover?\`var(--color-surface-tertiary)\`:(_bars?\`transparent\`:\`var(--color-surface-secondary)\`),borderColor:\`var(--color-border-subtle)\`},SubText:null,rightIcon:null,children:[`,
    `(0,${jsx}.jsx)(${menu}.ItemIcon,{size:\`sm\`,className:\`mt-0.5 self-start\`,children:(0,${jsx}.jsx)(${AVATAR},{account:_a,index:_p.index})}),`,
    `(0,${jsx}.jsxs)(\`div\`,{className:\`flex min-w-0 flex-1 flex-col\`,children:[`,
    `(0,${jsx}.jsxs)(\`div\`,{className:\`flex min-w-0 items-start justify-between gap-2\`,children:[`,
    `(0,${jsx}.jsxs)(\`div\`,{className:\`min-w-0 flex-1\`,children:[`,
    `(0,${jsx}.jsx)(\`span\`,{className:\`block truncate font-medium text-codex-primary\`,children:_plan?\`\${_cxpTitle(_a)} · \${_plan}\`:_cxpTitle(_a)}),`,
    `_sub?(0,${jsx}.jsx)(\`span\`,{className:\`block truncate text-xs text-codex-description\`,children:_sub}):null]}),_right]}),`,
    `_windowContent.length>0?(0,${jsx}.jsx)(\`div\`,{className:_bars?\`mt-2 flex w-full flex-col gap-2\`:\`mt-1.5 flex w-full gap-1.5\`,children:_windowContent}):null]})]})}`,

    `function ${BLOCK}(_props){`,
    "const _api=globalThis.__codexpp;",
    `const[_view,_setView]=(0,${react}.useState)(()=>{try{return _api?.accountsSync?.()??null}catch{return null}});`,
    `const[_routing,_setRouting]=(0,${react}.useState)(()=>{try{return _api?.routingView?.()??null}catch{return null}});`,
    `const[_usageView,_setUsageView]=(0,${react}.useState)(()=>{try{return localStorage.getItem(_cxpViewKey)===\`bars\`?\`bars\`:\`cards\`}catch{return \`cards\`}});`,
    `(0,${react}.useEffect)(()=>{`,
    "let _alive=!0;",
    "Promise.resolve(_api?.refreshUsage?.()).then(_v=>{if(_alive&&_v)_setView(_v)}).catch(()=>{});",
    "return()=>{_alive=!1}},[]);",
    "const _accounts=_view?.accounts??[];",
    "if(!_api||_accounts.length===0)return _props.usage??null;",
    "const _apply=_v=>{if(_v)_setView(_v)};",
    "const _pick=_id=>{Promise.resolve(globalThis.__cxpActivate?.(_id)).then(_apply).catch(()=>{})};",
    "const _signOut=_id=>{Promise.resolve(globalThis.__cxpSignOut?.(_id)).then(_apply).catch(()=>{})};",
    "const _autoRoute=_routing?.autoRoute!==!1;",
    "const _toggleAutoRoute=()=>{const _next=!_autoRoute;_api?.setAutoRoute?.(_next);_setRouting(_r=>({..._r,autoRoute:_next}))};",
    "const _changeUsageView=_next=>{const _safe=_next===`bars`?`bars`:`cards`;try{localStorage.setItem(_cxpViewKey,_safe)}catch{};_setUsageView(_safe)};",

    "const _activeAcc=_accounts.find(_a=>_a.id===_view?.activeAccountId);",
    "const _activeIneligible=_activeAcc&&(_activeAcc.planType===`free`||_activeAcc.planType===`go`||Boolean(_routing?.learnedIneligible?.[_activeAcc.id]));",
    "const _warning=_activeIneligible",
    `?(0,${jsx}.jsx)(${item},{disabled:!0,LeftIcon:${ALERT},SubText:\`This account is excluded from auto-routing\`,children:(0,${jsx}.jsx)(\`span\`,{className:\`text-amber-500 font-medium\`,children:\`Active account not eligible\`})},\`cxp-ineligible-warning\`)`,
    ":null;",

    "const _rows=_accounts.map((_a,_i)=>",
    `(0,${jsx}.jsx)(${ROW},{account:_a,index:_i,active:_a.id===_view?.activeAccountId,routing:_routing,`,
    "view:_usageView,onPick:()=>_pick(_a.id),onSignOut:()=>_signOut(_a.id)},`cxp-account-`+_a.id));",

    "const _known=_accounts.map(_a=>({w:typeof _a.planWeight===`number`&&_a.planWeight>0?_a.planWeight:1,left:_cxpLeft(_a.usedPercent)})).filter(_e=>_e.left!=null);",
    "const _total=_known.length===_accounts.length",
    `?(0,${jsx}.jsx)(\`span\`,{className:\`whitespace-nowrap text-codex-description\`,children:\`\${Math.round(_known.reduce((_s,_e)=>_s+_e.w*_e.left,0)/_known.reduce((_s,_e)=>_s+_e.w,0))}%\`}):null;`,
    "const _summary=_accounts.length>1",
    `?(0,${jsx}.jsx)(${item},{disabled:!0,LeftIcon:${GAUGE},`,
    "SubText:`${_accounts.length} connected subscriptions`,rightIcon:_total,",
    "children:`Usage remaining`},`cxp-summary`)",
    ":_props.usage??null;",

    `const _autoRow=(0,${jsx}.jsx)(${AUTOROW},{autoRoute:_autoRoute,onToggle:_toggleAutoRoute});`,
    `const _viewRow=(0,${jsx}.jsx)(${VIEWROW},{value:_usageView,onChange:_changeUsageView});`,

    "_rows.push(",
    "_autoRow,",
    "_viewRow,",
    `(0,${jsx}.jsx)(${item},{LeftIcon:${PLUS},onClick:()=>_api.addAccount(),children:\`Add another subscription\`},\`cxp-add-account\`));`,

    `return(0,${jsx}.jsxs)(${jsx}.Fragment,{children:[_summary,_warning,(0,${jsx}.jsx)(${menu}.Separator,{}),..._rows,(0,${jsx}.jsx)(${menu}.Separator,{})]})}`
  ].join("\n");
}

export default {
  id: "040-account-menu",
  description: "Account list, per-account usage, auto-routing toggle, eligibility badge and switching in profile menu",
  glob: "webview/assets/app-initial-*.js",
  marker: BLOCK,
  apply(source) {
    const head = matchOnce(source, HEAD_PATTERN, "profile menu component");
    const component = head[1];
    const usage = head[3];

    const start = head.index;
    const body = source.slice(start, start + 6000);

    const [, jsx, menu] = matchOnce(body, MENU_NS_PATTERN, "menu namespace");
    const [, item] = matchOnce(body, ITEM_PATTERN(jsx), "menu item");
    const children = matchOnce(body, CHILDREN_PATTERN(usage), "menu children array");
    const react = reactNamespace(source);

    const slots = children.slice(1);
    const patched =
      `children:[${slots.slice(0, 4).join(",")},` +
      `(0,${jsx}.jsx)(${BLOCK},{usage:${usage}}),${slots.slice(4).join(",")}]`;

    const withBlock =
      source.slice(0, start) +
      block({ jsx, menu, item, react }) +
      "\n" +
      source.slice(start, start + children.index) +
      patched +
      source.slice(start + children.index + children[0].length);

    const call = matchOnce(withBlock, CALL_PATTERN(component), "profile menu call site");
    const handler = call[1];
    const rewritten = call[0].replace(
      `onLogOut:${handler},`,
      `onLogOut:globalThis.__cxpLogOut(${handler}),`
    );

    return withBlock.slice(0, call.index) + rewritten + withBlock.slice(call.index + call[0].length);
  }
};
