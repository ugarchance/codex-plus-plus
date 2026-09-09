import { matchOnce, replaceOnce } from "../lib/anchor.mjs";
import { functionAt } from "../lib/ast.mjs";

/**
 * Patch 095: Account picker in the local thread header
 *
 * The header is slot based: the Share button registers itself through
 * `HeaderAction` (actionId `codex-conversation-share`, align end, order 100)
 * from the local-conversation-page chunk. This patch registers a sibling
 * action (order 99, so it renders left of Share) whose node is a small picker:
 * - normal chats: the connected ChatGPT accounts; the check marks the pinned
 *   owner, or the engine's active account when nothing is pinned. Picking a
 *   row pins the chat (__cxpPinThread, patch 093) and an "Automatic" row
 *   removes the pin (forgetThreadOwner).
 * - external-provider chats (patch 121 route): the provider label plus
 *   "Continue with ChatGPT (copy)", which forks the thread with a native
 *   model (one-shot __cxpForkModel override, patch 093) and opens the copy
 *   through the navigation bridge (patch 094). A stock Codex app cannot
 *   resume an external thread, so the copy is the way back.
 * The menu is a native <dialog> shown in the top layer: the header clips its
 * descendants with `contain: paint`, and this chunk has no react-dom portal.
 */

const NAME = "[A-Za-z_$][\\w$]*";
const MARKER = "__cxpThreadAccountPicker";
const SHARE_PATTERN =
  `\\(0,(${NAME})\\.jsx\\)\\((${NAME})\\.HeaderAction,\\{actionId:\`codex-conversation-share\`,align:\`end\`,order:100,` +
  `unifiedSlotPosition:\`main\`,children:\\(0,\\1\\.jsx\\)\\((${NAME}),\\{conversationId:(${NAME}),hostId:(${NAME})\\}\\)\\}\\)`;

export function helpers({ react, jsx }) {
  return [
    ";(()=>{",
    "const _cxpTones=['--color-chart-green','--color-chart-blue','--color-chart-yellow','--color-chart-red','--color-chart-orange'];",
    "const _cxpPlans={free:'Free',go:'Go',plus:'Plus',pro:'Pro',prolite:'Pro Lite',team:'Team',business:'Business',enterprise:'Enterprise',edu:'Edu'};",
    // Pure: what the picker shows for a thread. Tested in tools/test-thread-account-header.mjs.
    "globalThis.__cxpThreadAccountRows=(_view,_routing,_threadId,_route,_connections)=>{",
    "const _accounts=_view?.accounts??[];const _active=_view?.activeAccountId??null;",
    "if(_route){const _conn=(_connections??[]).find(_c=>_c.id===_route.connectionId);const _model=_route.modelId??null;",
    "return{kind:'external',label:_conn?.label??(_model?_model.split('/')[1]:null)??'External provider',model:_model,rows:[],selectedId:null,pinned:false}}",
    "const _owner=_threadId?_routing?.threadOwner?.[_threadId]??null:null;",
    "const _pinned=Boolean(_owner&&_accounts.some(_a=>_a.id===_owner));",
    "const _selectedId=_pinned?_owner:_active;",
    "const _rows=_accounts.map(_a=>({id:_a.id,label:_a.label??_a.email??_a.id,plan:_a.planType??null,left:typeof _a.usedPercent==='number'?Math.max(0,Math.round(100-_a.usedPercent)):null,selected:_a.id===_selectedId,ineligible:_a.planType==='free'||_a.planType==='go'||Boolean(_routing?.learnedIneligible?.[_a.id])}));",
    "return{kind:'accounts',label:_rows.find(_r=>_r.selected)?.label??'Account',rows:_rows,selectedId:_selectedId,pinned:_pinned}};",
    `globalThis.${MARKER}=function _cxpThreadAccountPicker(_props){`,
    `const R=${react},J=${jsx},_api=globalThis.__codexpp,_id=_props.conversationId;`,
    "const _read=(_route,_conns)=>{let _view=null,_routing=null;try{_view=_api?.accountsSync?.()??null}catch{}try{_routing=_api?.routingView?.()??null}catch{}return globalThis.__cxpThreadAccountRows(_view,_routing,_id,_route,_conns)};",
    "const [_open,_setOpen]=R.useState(false),[_state,_setState]=R.useState(()=>_read(null,null)),[_busy,_setBusy]=R.useState(false),[_error,_setError]=R.useState(null),[_hover,_setHover]=R.useState(null);",
    "const _dialog=R.useRef(null),_button=R.useRef(null),_alive=R.useRef(true);",
    "R.useEffect(()=>{_alive.current=true;return()=>{_alive.current=false}},[]);",
    "const _refresh=R.useCallback(async()=>{let _route=null,_conns=null;",
    "try{_route=await globalThis.__cxpProviderCall?.('route',_id)}catch{}",
    "if(_route){try{_conns=(await globalThis.__cxpProviderCall?.('view'))?.connections??null}catch{}}",
    "if(_alive.current)_setState(_read(_route??null,_conns))},[_id]);",
    "R.useEffect(()=>{_refresh()},[_refresh]);",
    "R.useEffect(()=>{const _d=_dialog.current;if(!_d)return;",
    "if(!_open){if(_d.open)_d.close();return}",
    "if(!_d.open){const _r=_button.current?.getBoundingClientRect();_d.style.top=((_r?_r.bottom:40)+6)+'px';_d.style.left=Math.max(8,Math.min(innerWidth-272,(_r?_r.right:innerWidth)-264))+'px';try{_d.showModal()}catch{}}",
    "const _onClose=()=>_setOpen(false),_onClick=_e=>{if(_e.target===_d)_setOpen(false)};",
    "_d.addEventListener('close',_onClose);_d.addEventListener('click',_onClick);",
    "return()=>{_d.removeEventListener('close',_onClose);_d.removeEventListener('click',_onClick)}},[_open]);",
    "const _run=async _fn=>{if(_busy)return;_setBusy(true);_setError(null);try{await _fn();if(_alive.current){await _refresh();_setOpen(false)}}catch(_e){if(_alive.current)_setError(String(_e?.message??_e))}finally{if(_alive.current)_setBusy(false)}};",
    "const _pick=_accountId=>_run(async()=>{if(!await globalThis.__cxpPinThread?.(_id,_accountId))throw Error('This account has no valid token. Sign in again from the profile menu.')});",
    "const _automatic=()=>_run(()=>_api?.forgetThreadOwner?.(_id));",
    "const _copy=()=>_run(async()=>{const _client=globalThis.__cxpClients?.local;if(!_client)throw Error('The local engine is not available.');",
    "let _model=null;try{_model=(await _client.sendRequest('config/read',{}))?.config?.model??null}catch{}",
    "if(!_model||String(_model).startsWith('cxp/')){const _list=(await _client.sendRequest('model/list',{includeHidden:false,cursor:null,limit:50}))?.data??[];const _native=_list.filter(_m=>!String(_m.model??_m.id??'').startsWith('cxp/'));_model=(_native.find(_m=>_m.isDefault)??_native[0])?.model??null}",
    "if(!_model)throw Error('No ChatGPT model is available.');",
    "let _cwd;try{_cwd=_client.getConversationCwd?.(_id)??_client.getConversation?.(_id)?.cwd??undefined}catch{}",
    "globalThis.__cxpForkModel=_model;let _result;try{_result=await _client.forkConversationFromLatest({sourceConversationId:_id,cwd:_cwd,model:_model})}finally{globalThis.__cxpForkModel=null}",
    "const _next=_result?.conversationId;if(!_next)throw Error(_result?.status==='not-ready'?'The engine is not ready yet. Try again.':'The copy could not be created.');",
    "globalThis.__cxpNavigation?.navigateToLocalConversation?.(_next)});",
    "const _external=_state.kind==='external';",
    "const _tone=_i=>'var('+_cxpTones[Math.max(0,_i)%_cxpTones.length]+')';",
    "const _avatar=(_text,_i,_size)=>J.jsx('span',{'aria-hidden':true,className:'flex shrink-0 items-center justify-center rounded-full font-medium',style:{width:_size,height:_size,fontSize:Math.round(_size*0.55),lineHeight:1,background:_tone(_i),color:'#fff'},children:String(_text||'?').trim().slice(0,1).toUpperCase()});",
    "const _row=(_key,_o)=>J.jsxs('button',{type:'button',disabled:Boolean(_o.disabled)||_busy,'data-cxp':'thread-account-row','data-row':_key,onMouseEnter:()=>_setHover(_key),onMouseLeave:()=>_setHover(null),onClick:_o.onClick,className:'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',style:{background:_hover===_key&&!_o.disabled?'var(--color-surface-tertiary)':'transparent',border:'none',color:'inherit',opacity:_o.disabled?0.65:1,cursor:_o.disabled?'default':'pointer'},children:[_o.icon??null,J.jsxs('span',{className:'flex min-w-0 flex-1 flex-col',children:[J.jsx('span',{className:'truncate text-codex-primary',children:_o.title}),_o.sub?J.jsx('span',{className:'truncate text-xs text-codex-description',children:_o.sub}):null]}),_o.right??null]},_key);",
    "const _check=J.jsx('svg',{width:14,height:14,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2.5,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,children:J.jsx('path',{d:'M5 12l5 5L19 7'})});",
    "const _chevron=J.jsx('svg',{width:12,height:12,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,className:'shrink-0',children:J.jsx('path',{d:'M6 9l6 6 6-6'})});",
    "const _items=[];",
    "if(_external){_items.push(_row('provider',{disabled:true,icon:_avatar(_state.label,4,18),title:'Runs on '+_state.label,sub:_state.model??null}));",
    "_items.push(_row('copy',{icon:J.jsx('span',{className:'flex shrink-0 items-center justify-center',style:{width:18},children:_chevron}),title:'Continue with ChatGPT (copy)',sub:'Copies this conversation into a ChatGPT-backed chat',onClick:_copy}))}",
    "else{_state.rows.forEach((_r,_i)=>_items.push(_row(_r.id,{icon:_avatar(_r.label,_i,18),title:_r.plan?_r.label+' \\u00b7 '+(_cxpPlans[_r.plan]??_r.plan):_r.label,sub:_r.ineligible?'Not eligible for Codex':null,right:J.jsxs('span',{className:'flex shrink-0 items-center gap-1.5 text-xs text-codex-description',children:[_r.left==null?null:_r.left+'%',_r.selected?_check:null]}),onClick:()=>_pick(_r.id)})));",
    "if(_state.pinned)_items.push(_row('automatic',{icon:J.jsx('span',{style:{width:18}}),title:'Automatic',sub:'Follow the active account',onClick:_automatic}))}",
    "const _selectedIndex=_external?4:Math.max(0,_state.rows.findIndex(_r=>_r.selected));",
    "return J.jsxs(J.Fragment,{children:[",
    "J.jsxs('button',{ref:_button,type:'button','data-cxp':'thread-account-trigger','aria-label':'Account for this chat','aria-haspopup':'dialog','aria-expanded':_open,title:_external?'This chat runs on '+_state.label:(_state.pinned?'Pinned to '+_state.label:'Using the active account: '+_state.label),onClick:()=>{_setError(null);_refresh();_setOpen(true)},onMouseEnter:()=>_setHover('trigger'),onMouseLeave:()=>_setHover(null),className:'no-drag cursor-interaction flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-codex-primary',style:{maxWidth:180,background:_hover==='trigger'?'var(--color-surface-tertiary)':'transparent',border:'none'},children:[_avatar(_state.label,_selectedIndex,16),J.jsx('span',{className:'truncate',children:_state.label}),_chevron]}),",
    "J.jsxs('dialog',{ref:_dialog,'data-cxp':'thread-account-menu','aria-label':'Account for this chat',className:'text-codex-primary',style:{position:'fixed',inset:'auto',margin:0,padding:4,minWidth:264,maxWidth:340,border:'1px solid var(--color-border-subtle)',borderRadius:10,background:'var(--color-surface-secondary)',color:'inherit',boxShadow:'0 8px 24px rgba(0,0,0,.28)'},children:[",
    "J.jsx('style',{children:'dialog[data-cxp=thread-account-menu]::backdrop{background:transparent}'}),",
    "J.jsx('div',{className:'px-2 pb-1 pt-1.5 text-xs text-codex-description',children:_external?'Provider for this chat':(_state.pinned?'This chat is pinned to':'Account for this chat (active)')}),",
    "..._items,",
    "_error?J.jsx('div',{className:'px-2 py-1.5 text-xs',style:{color:'var(--color-text-danger,#e5484d)'},children:_error}):null]})]})};",
    "})();"
  ].join("\n");
}

export default {
  id: "095-thread-account-header",
  description: "Account picker next to Share in the local thread header, with copy-to-ChatGPT for external-provider chats",
  glob: "webview/assets/local-conversation-page-*.js",
  select: "codex-conversation-share",
  marker: MARKER,
  apply(source) {
    const component = functionAt(source, "codex-conversation-share");
    const window = source.slice(component.start, component.end);
    const [, react] = matchOnce(window, `\\(0,(${NAME})\\.useState\\)\\(null\\)`, "React namespace of the local conversation page");
    const [anchor, jsx, header, , conversation, host] = matchOnce(source, SHARE_PATTERN, "share header action registration");
    const ours =
      `(0,${jsx}.jsx)(${header}.HeaderAction,{actionId:\`cxp-thread-account\`,align:\`end\`,order:99,unifiedSlotPosition:\`main\`,` +
      `children:(0,${jsx}.jsx)(globalThis.${MARKER},{conversationId:${conversation},hostId:${host}})},\`cxp-thread-account\`)`;
    const theirs = anchor.slice(0, -1) + ",`codex-conversation-share`)";
    const patched = replaceOnce(source, anchor, `(0,${jsx}.jsxs)(${jsx}.Fragment,{children:[${ours},${theirs}]})`);
    return `${helpers({ react, jsx })}\n${patched}`;
  }
};
