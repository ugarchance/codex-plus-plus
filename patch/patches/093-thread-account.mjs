import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

/**
 * Patch 093: Per-chat account
 *
 * routing.json records which account owns each thread (threadOwner, patch
 * 090). This patch makes that pin effective without touching the default
 * account the user picked in the profile menu:
 * - publishes the selected thread id (`activeThreadId` prop of the main
 *   layout, computed from the route kind) as globalThis.__cxpActiveThreadId,
 *   null on the home / new-chat routes whose draft ids end in `new-conversation`;
 * - before `turn/start` on the local request client, moves the engine to the
 *   thread's pinned account (transient activation: the hub keeps the default);
 * - after `turn/completed` / `turn/failed`, and when the selected chat
 *   changes, moves the engine back to the default account, but never while a
 *   turn is still running (its later model calls must keep their account);
 * - exposes __cxpPinThread for the profile menu (040) and the header picker
 *   (095): record the owner only, the switch happens with the next message;
 * - applies a one-shot native model override to `thread/fork` when patch 095
 *   copies an external-provider chat back to ChatGPT (__cxpForkModel).
 * Threads routed to external providers (patch 121) are left alone.
 */

const NAME = "[A-Za-z_$][\\w$]*";
const MARKER = "__cxpInstallThreadAccounts";

export const helpers = [
  ";(()=>{",
  "globalThis.__cxpActiveThreadId??=null;",
  "const _cxpRunning=new Set;let _cxpSwitching=null;",
  "globalThis.__cxpRunningTurns=_cxpRunning;",
  "globalThis.__cxpThreadOwner=_threadId=>{try{const _r=globalThis.__codexpp?.routingView?.();return(_threadId&&_r?.threadOwner?.[_threadId])||null}catch{return null}};",
  "const _cxpDefault=_view=>_view?.defaultAccountId??_view?.activeAccountId??null;",
  // The account a thread's requests must use: a usable pinned owner, else the default account.
  "globalThis.__cxpThreadTarget=_threadId=>{try{const _api=globalThis.__codexpp;const _view=_api?.accountsSync?.();if(!_view)return null;const _default=_cxpDefault(_view);const _owner=globalThis.__cxpThreadOwner(_threadId);if(!_owner)return _default;const _account=_view.accounts?.find(_a=>_a.id===_owner);if(!_account)return _default;if(typeof _account.usedPercent===`number`&&_account.usedPercent>=100)return _default;if(_api.routingView?.()?.learnedIneligible?.[_owner])return _default;return _owner}catch{return null}};",
  // Move the engine (not the default) to an account; switches are serialised and skipped while a turn runs.
  "globalThis.__cxpEngineTo=_accountId=>{const _api=globalThis.__codexpp;if(!_api||!_accountId)return Promise.resolve(null);const _run=()=>{const _now=_api.accountsSync?.();if(!_now||_now.activeAccountId===_accountId)return _now??null;if(_cxpRunning.size>0)return null;return globalThis.__cxpActivate?.(_accountId,{transient:!0})};_cxpSwitching=(_cxpSwitching??Promise.resolve()).then(_run,_run).catch(()=>null);return _cxpSwitching};",
  "globalThis.__cxpFollowThread=_threadId=>{try{const _target=globalThis.__cxpThreadTarget(_threadId);return _target?globalThis.__cxpEngineTo(_target):Promise.resolve(null)}catch{return Promise.resolve(null)}};",
  "globalThis.__cxpRestoreDefault=()=>{try{const _view=globalThis.__codexpp?.accountsSync?.();const _default=_cxpDefault(_view);return _default&&_default!==_view?.activeAccountId?globalThis.__cxpEngineTo(_default):Promise.resolve(null)}catch{return Promise.resolve(null)}};",
  // Called from the main layout render with the route's thread id.
  "globalThis.__cxpPublishThread=_id=>{const _next=typeof _id===`string`&&!_id.endsWith(`new-conversation`)?_id:null;if(_next===globalThis.__cxpActiveThreadId)return;globalThis.__cxpActiveThreadId=_next;globalThis.__cxpRestoreDefault?.()};",
  // Menu / header action: pin the chat. The engine follows when the next message is sent.
  "globalThis.__cxpPinThread=async(_threadId,_accountId)=>{const _api=globalThis.__codexpp;if(!_api||!_threadId||!_accountId)return null;const _view=_api.accountsSync?.();if(!_view?.accounts?.some(_a=>_a.id===_accountId))return null;await _api.learnThreadOwner?.(_threadId,_accountId);return _api.accountsSync?.()??_view};",
  `globalThis.${MARKER}=(_client,_manager)=>{`,
  "if(!_client.__cxpThreadAccountsInstalled){_client.__cxpThreadAccountsInstalled=!0;const _original=_client.sendRequest.bind(_client);",
  "_client.sendRequest=async(_method,_params,..._rest)=>{",
  "if(_method===`thread/fork`&&globalThis.__cxpForkModel){_params={..._params,model:globalThis.__cxpForkModel};globalThis.__cxpForkModel=null}",
  "const _local=_client===globalThis.__cxpClients?.local?.requestClient;",
  "if(_local&&_method===`turn/start`&&_params?.threadId&&!_params?.model?.startsWith?.(`cxp/`)){await globalThis.__cxpFollowThread(_params.threadId);_cxpRunning.add(_params.threadId)}",
  "try{return await _original(_method,_params,..._rest)}catch(_e){if(_local&&_method===`turn/start`&&_params?.threadId){_cxpRunning.delete(_params.threadId);globalThis.__cxpRestoreDefault?.()}throw _e}}}",
  "if(_manager&&!_manager.__cxpThreadAccountsInstalled&&typeof _manager.handleNotification===`function`){_manager.__cxpThreadAccountsInstalled=!0;const _notify=_manager.handleNotification.bind(_manager);",
  "_manager.handleNotification=_e=>{try{if((_e?.method===`turn/completed`||_e?.method===`turn/failed`)&&_manager===globalThis.__cxpClients?.local){_cxpRunning.delete(_e.params?.threadId);if(_cxpRunning.size===0)globalThis.__cxpRestoreDefault?.()}}catch{}return _notify(_e)}}};",
  "})();"
].join("\n");

const THREAD_PATTERN = `\\{activeThreadId:(${NAME})\\}=(${NAME});`;
const CLIENT_PATTERN = `this\\.requestClient=(${NAME});let (${NAME})=this\\.settings\\.restricted;`;

export default {
  id: "093-thread-account",
  description: "Publish the open thread id and run each chat's turns on its pinned account",
  glob: "webview/assets/app-initial-*.js",
  marker: MARKER,
  apply(source) {
    const [threadAnchor, threadId] = matchOnce(source, THREAD_PATTERN, "main layout activeThreadId prop");
    let patched = replaceOnce(source, threadAnchor, `${threadAnchor}globalThis.__cxpPublishThread?.(${threadId});`);
    const [clientAnchor, client] = matchOnce(patched, CLIENT_PATTERN, "AppServerManager request client");
    patched = replaceOnce(patched, clientAnchor, `${clientAnchor}globalThis.${MARKER}?.(${client},this);`);
    return `${helpers}\n${patched}`;
  }
};
