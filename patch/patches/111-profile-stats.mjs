/**
 * Discovery process for Profile Stats / Avatar Stack anchor:
 * 1. Located the WHAM profile usage hook and query functions:
 *    - Wol: query key constructor ['profile', 'usage', userId, accountId]
 *    - Gol: useQuery hook for fetching /wham/profiles/me
 *    - Yol: safeGet('/wham/profiles/me') returning { activityInsights, dailyUsage, displayName, summary, username }
 * 2. Traced profile presentation components in the webview bundle (12.7MB+):
 *    - Located the profile header component Col responsible for rendering the avatar, display name, username, and account subtitle.
 *    - Identified the unique, semantic prop signature:
 *      function Col({ account, avatar, displayName, username })
 *    - Confirmed this signature matches exactly once across the entire 14MB minified bundle.
 * 3. Inside the component:
 *    - Captured the JSX runtime namespace and avatar variable name.
 *    - Replaced the single static avatar container with _cxpProfileAvatarStack:
 *      - Renders an interactive avatar stack of connected subscriptions with distinct chart tone palettes.
 *      - Shows active selection state and allows one-click switching across accounts.
 *      - Preserves single-account layout when only one account is connected.
 */

import { matchOnce } from "../lib/anchor.mjs";

const NAME = "[A-Za-z_$][\\w$]*";
const BLOCK = "_cxpProfileAvatarStack";
const HOOKS_PATTERN = `\\(0,(${NAME})\\.useState\\)`;

function reactNamespace(source) {
  for (const match of source.matchAll(new RegExp(HOOKS_PATTERN, "g"))) {
    const ns = match[1];
    if (source.includes(`(0,${ns}.useEffect)`)) return ns;
  }
  throw new Error("react namespace not found");
}

function block({ jsx, react }) {
  return [
    `function ${BLOCK}(_props){`,
    "const _api=globalThis.__codexpp;",
    `const[_view,_setView]=(0,${react}.useState)(()=>{try{return _api?.accountsSync?.()??null}catch{return null}});`,
    `(0,${react}.useEffect)(()=>{`,
    "let _alive=!0;",
    "Promise.resolve(_api?.refreshUsage?.()).then(_v=>{if(_alive&&_v)_setView(_v)}).catch(()=>{});",
    "return()=>{_alive=!1}},[]);",
    "const _accounts=_view?.accounts??[];",
    "const _activeId=_view?.activeAccountId;",
    `if(!_api||_accounts.length<=1)return(0,${jsx}.jsx)(\`div\`,{className:\`relative mb-4 size-20\`,children:_props.avatar});`,
    "const _pick=_id=>{Promise.resolve(globalThis.__cxpActivate?.(_id)??_api?.activate?.(_id)).then(_v=>{if(_v)_setView(_v)}).catch(()=>{})};",
    "const _tones=[\`--color-chart-green\`,\`--color-chart-blue\`,\`--color-chart-yellow\`,\`--color-chart-red\`,\`--color-chart-orange\`];",
    "const _avatars=_accounts.map((_a,_i)=>{",
    "const _tone=_tones[_i%_tones.length];",
    "const _title=(_a.label??_a.email??_a.id).split(`@`)[0];",
    "const _initial=_title.trim().slice(0,1).toUpperCase();",
    "const _isActive=_a.id===_activeId;",
    `const _inner=_a.avatarUrl?(0,${jsx}.jsx)(\`img\`,{src:_a.avatarUrl,alt:_title,className:\`size-full rounded-full object-cover\`}):(0,${jsx}.jsx)(\`span\`,{className:\`flex size-full items-center justify-center font-medium text-[11px] leading-none\`,children:_initial});`,
    `return(0,${jsx}.jsx)(\`button\`,{type:\`button\`,title:\`\${_title}\${_isActive?\` (Active)\`:\`\`}\`,onClick:()=>_pick(_a.id),className:\`relative size-9 rounded-full cursor-pointer transition-transform hover:scale-105 hover:z-20 -ml-2 first:ml-0 shadow-sm border-2 \${_isActive?\`border-primary ring-2 ring-primary/40 z-10\`:\`border-token-surface-primary hover:border-token-border-light\`}\`,style:{backgroundColor:\`color-mix(in srgb, var(\${_tone}, #8a8a8a) 25%, transparent)\`,color:\`var(\${_tone}, #b4b4b4)\`},children:_inner},\`cxp-stack-\`+_a.id);});`,
    `return(0,${jsx}.jsxs)(\`div\`,{className:\`relative mb-4 flex flex-col items-center gap-2\`,children:[(0,${jsx}.jsx)(\`div\`,{className:\`relative size-20\`,children:_props.avatar}),(0,${jsx}.jsx)(\`div\`,{className:\`flex items-center justify-center pt-1\`,children:(0,${jsx}.jsx)(\`div\`,{className:\`flex items-center pl-2\`,children:_avatars})})]})}`
  ].join("\n");
}

const HEAD_PATTERN = `function (${NAME})\\(\\{account:(${NAME}),avatar:(${NAME}),displayName:(${NAME}),username:(${NAME})\\}\\)`;

export default {
  id: "111-profile-stats",
  description: "Avatar stack and per-account view switcher in profile view header",
  glob: "webview/assets/app-initial-*.js",
  marker: BLOCK,
  apply(source) {
    const head = matchOnce(source, HEAD_PATTERN, "profile header component");
    const start = head.index;
    const body = source.slice(start, start + 2000);

    const JSX_PATTERN = `\\(0,(${NAME})\\.jsxs\\)\\((${NAME})\\.Fragment,\\{children:\\[\\(0,(${NAME})\\.jsx\\)\\(\`div\`,\\{className:\`relative mb-4 size-20\`,children:(${NAME})\\}`;
    const jsxMatch = matchOnce(body, JSX_PATTERN, "jsx fragment and avatar container");
    const jsx = jsxMatch[1];
    const avatarVar = jsxMatch[4];
    const react = reactNamespace(source);

    const replacement = `(0,${jsx}.jsxs)(${jsx}.Fragment,{children:[(0,${jsx}.jsx)(${BLOCK},{avatar:${avatarVar}}`;
    const patchedBody = body.slice(0, jsxMatch.index) + replacement + body.slice(jsxMatch.index + jsxMatch[0].length);

    return (
      source.slice(0, start) +
      block({ jsx, react }) +
      "\n" +
      patchedBody +
      source.slice(start + 2000)
    );
  }
};
