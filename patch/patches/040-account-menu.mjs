import { matchOnce } from "../lib/anchor.mjs";

const NAME = "[A-Za-z_$][\\w$]*";
const BLOCK = "_cxpAccountBlock";
const PLUS = "_cxpPlusIcon";
const CHECK = "_cxpCheckIcon";
const GAUGE = "_cxpGaugeIcon";
const AVATAR = "_cxpAvatar";

const HEAD_PATTERN =
  `function ${NAME}\\((${NAME})\\)\\{let ${NAME}=\\(0,${NAME}\\.c\\)\\(\\d+\\),` +
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
  "\\}=\\1";

const MENU_NS_PATTERN = `\\(0,(${NAME})\\.jsx\\)\\((${NAME})\\.ItemIcon,`;

const ITEM_PATTERN = (jsx) =>
  `\\(0,${jsx}\\.jsx\\)\\((${NAME}),\\{className:(${NAME})==null\\?\`opacity-100\`:void 0,` +
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
  throw new Error("react ad alani bulunamadi");
}

function block({ jsx, menu, item, react }) {
  const icon = (path) =>
    `function _cxpIcon(_p){` +
    `return(0,${jsx}.jsx)(\`svg\`,{className:_p.className,viewBox:\`0 0 20 20\`,fill:\`none\`,` +
    `children:(0,${jsx}.jsx)(\`path\`,{d:\`${path}\`,stroke:\`currentColor\`,strokeWidth:1.5,` +
    `strokeLinecap:\`round\`,strokeLinejoin:\`round\`})})}`;

  return [
    icon("M10 4.75v10.5M4.75 10h10.5").replace("_cxpIcon", PLUS),
    icon("M4.5 10.5l3.5 3.5 7.5-8").replace("_cxpIcon", CHECK),
    icon("M10 17.25a7.25 7.25 0 1 1 7.25-7.25M10 10l3.6-3.6").replace("_cxpIcon", GAUGE),

    `const _cxpTones=[\`--color-chart-green\`,\`--color-chart-blue\`,\`--color-chart-yellow\`,\`--color-chart-red\`,\`--color-chart-orange\`];`,
    "const _cxpPlans={free:`Free`,plus:`Plus`,pro:`Pro`,team:`Team`,business:`Business`,enterprise:`Enterprise`};",
    "function _cxpPlan(_v){return _v?_cxpPlans[_v]??_v:null}",
    "function _cxpLeft(_v){return typeof _v===`number`?Math.max(0,Math.round(100-_v)):null}",
    "function _cxpTitle(_a){const _l=_a.label??_a.email??_a.id;return _a.email&&_l===_a.email?_l.split(`@`)[0]:_l}",

    `function ${AVATAR}(_p){`,
    "const _a=_p.account,_i=_p.index;",
    `if(_a.avatarUrl)return(0,${jsx}.jsx)(\`img\`,{src:_a.avatarUrl,alt:\`\`,className:\`icon-sm rounded-full object-cover\`});`,
    "const _tone=_cxpTones[_i%_cxpTones.length];",
    "const _text=_cxpTitle(_a).trim().slice(0,1).toUpperCase();",
    `return(0,${jsx}.jsx)(\`span\`,{`,
    "className:`icon-sm flex items-center justify-center rounded-full text-[9px] leading-none`,",
    "style:{backgroundColor:`color-mix(in srgb, var(${_tone}, #8a8a8a) 20%, transparent)`,color:`var(${_tone}, #b4b4b4)`},",
    "children:_text})}",

    `function ${BLOCK}(_props){`,
    "const _api=globalThis.__codexpp;",
    `const[_view,_setView]=(0,${react}.useState)(()=>{try{return _api?.accountsSync?.()??null}catch{return null}});`,
    `(0,${react}.useEffect)(()=>{`,
    "let _alive=!0;",
    "Promise.resolve(_api?.refreshUsage?.()).then(_v=>{if(_alive&&_v)_setView(_v)}).catch(()=>{});",
    "return()=>{_alive=!1}},[]);",
    "const _accounts=_view?.accounts??[];",
    "if(!_api||_accounts.length===0)return _props.usage??null;",
    "const _pick=_id=>{Promise.resolve(_api.setDefault(_id)).then(_v=>{if(_v)_setView(_v)}).catch(()=>{})};",

    "const _rows=_accounts.map((_a,_i)=>{",
    "const _left=_cxpLeft(_a.usedPercent);",
    "const _active=_a.id===_view?.defaultAccountId;",
    "const _plan=_cxpPlan(_a.planType);",
    `const _right=(0,${jsx}.jsxs)(\`span\`,{className:\`flex items-center gap-1 whitespace-nowrap text-codex-description\`,children:[`,
    `_active?(0,${jsx}.jsx)(${CHECK},{className:\`icon-xs\`}):null,`,
    "_left==null?`—`:`${_left}%`]});",
    `return(0,${jsx}.jsxs)(${item},{`,
    "onClick:()=>_pick(_a.id),",
    "SubText:_a.email??null,",
    "rightIcon:_right,",
    `children:[(0,${jsx}.jsx)(${menu}.ItemIcon,{size:\`sm\`,children:(0,${jsx}.jsx)(${AVATAR},{account:_a,index:_i})}),`,
    "_plan?`${_cxpTitle(_a)} · ${_plan}`:_cxpTitle(_a)]},`cxp-account-`+_a.id)});",

    "const _known=_accounts.map(_a=>_cxpLeft(_a.usedPercent)).filter(_v=>_v!=null);",
    "const _total=_known.length===_accounts.length",
    `?(0,${jsx}.jsx)(\`span\`,{className:\`whitespace-nowrap text-codex-description\`,children:\`\${_known.reduce((_s,_v)=>_s+_v,0)}%\`}):null;`,
    "const _summary=_accounts.length>1",
    `?(0,${jsx}.jsx)(${item},{disabled:!0,LeftIcon:${GAUGE},`,
    "SubText:`${_accounts.length} connected subscriptions`,rightIcon:_total,",
    "children:`Usage remaining`},`cxp-summary`)",
    ":_props.usage??null;",

    "_rows.push(",
    `(0,${jsx}.jsx)(${item},{LeftIcon:${PLUS},onClick:()=>_api.addAccount(),children:\`Add another subscription\`},\`cxp-add-account\`));`,

    `return(0,${jsx}.jsxs)(${jsx}.Fragment,{children:[_summary,(0,${jsx}.jsx)(${menu}.Separator,{}),..._rows,(0,${jsx}.jsx)(${menu}.Separator,{})]})}`
  ].join("\n");
}

export default {
  id: "040-account-menu",
  description: "Account list, per-account usage and add-subscription entry in the profile dropdown",
  glob: "webview/assets/app-initial-*.js",
  marker: BLOCK,
  apply(source) {
    const head = matchOnce(source, HEAD_PATTERN, "profil menusu bileseni");
    const usage = head[2];

    const start = head.index;
    const body = source.slice(start, start + 6000);

    const [, jsx, menu] = matchOnce(body, MENU_NS_PATTERN, "menu ad alani");
    const [, item] = matchOnce(body, ITEM_PATTERN(jsx), "menu ogesi");
    const children = matchOnce(body, CHILDREN_PATTERN(usage), "menu children dizisi");
    const react = reactNamespace(source);

    const slots = children.slice(1);
    const patched =
      `children:[${slots.slice(0, 4).join(",")},` +
      `(0,${jsx}.jsx)(${BLOCK},{usage:${usage}}),${slots.slice(4).join(",")}]`;

    return (
      source.slice(0, start) +
      block({ jsx, menu, item, react }) +
      "\n" +
      source.slice(start, start + children.index) +
      patched +
      source.slice(start + children.index + children[0].length)
    );
  }
};
