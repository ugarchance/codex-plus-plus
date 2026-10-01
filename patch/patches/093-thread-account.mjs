import { matchOnce, replaceOnce } from "../lib/anchor.mjs";
import { afterManagerInitialized, managerSelector } from "../lib/manager.mjs";

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
 * - after `turn/completed` / `turn/failed` (a notification callback on the
 *   manager) and when the selected chat changes, moves the engine back to the
 *   default account, but never while a turn is still running (its later model
 *   calls must keep their account);
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
  "const _cxpRunning=new Set;let _cxpSwitching=null,_cxpStarting=Promise.resolve();",
  "globalThis.__cxpRunningTurns=_cxpRunning;",
  "globalThis.__cxpThreadOwner=_threadId=>{try{const _r=globalThis.__codexpp?.routingView?.();return(_threadId&&_r?.threadOwner?.[_threadId])||null}catch{return null}};",
  "const _cxpDefault=_view=>_view?.defaultAccountId??_view?.activeAccountId??null;",
  // An explicit pin never silently falls back to another account's quota.
  "globalThis.__cxpThreadTarget=_threadId=>{try{const _view=globalThis.__codexpp?.accountsSync?.();return _view?(globalThis.__cxpThreadOwner(_threadId)||_cxpDefault(_view)):null}catch{return null}};",
  // Move the engine (not the default) to an account; switches are serialised and skipped while a turn runs.
  "globalThis.__cxpEngineTo=_accountId=>{const _api=globalThis.__codexpp;if(!_api||!_accountId)return Promise.resolve(null);const _run=()=>{const _now=_api.accountsSync?.();if(!_now)return null;if(_now.activeAccountId===_accountId&&globalThis.__cxpConfirmedAccountId===_accountId)return _now;if(_cxpRunning.size>0)return null;return globalThis.__cxpActivate?.(_accountId,{transient:!0})};_cxpSwitching=(_cxpSwitching??Promise.resolve()).then(_run,_run).catch(()=>null);return _cxpSwitching};",
  "globalThis.__cxpFollowThread=_threadId=>{try{const _target=globalThis.__cxpThreadTarget(_threadId);return _target?globalThis.__cxpEngineTo(_target):Promise.resolve(null)}catch{return Promise.resolve(null)}};",
  "const _cxpPrepareTurn=_threadId=>{const _run=async()=>{if(_cxpRunning.has(_threadId))throw Error(`This chat already has a running message.`);const _target=globalThis.__cxpThreadTarget(_threadId),_api=globalThis.__codexpp,_account=_api?.accountsSync?.()?.accounts?.find(_a=>_a.id===_target);if(!_account)throw Error(`This chat's account is unavailable. Choose an account from the chat header.`);if(_account.usedPercent>=100||_api?.routingView?.()?.learnedIneligible?.[_target])throw Error(`This chat's account has no available Codex quota. Choose another account from the chat header.`);globalThis.__cxpPendingTurnTarget=_target;try{await globalThis.__cxpEngineTo(_target);const _active=_api.accountsSync?.()?.activeAccountId;if(_active!==_target||globalThis.__cxpConfirmedAccountId!==_target)throw Error(_cxpRunning.size?`Another account has a running chat. Wait for it to finish before sending this message.`:`Could not sign in to this chat's account. Sign in again before sending.`);_cxpRunning.add(_threadId)}finally{globalThis.__cxpPendingTurnTarget=null}};const _result=_cxpStarting.then(_run,_run);_cxpStarting=_result.catch(()=>null);return _result};",
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
  "if(_local&&_method===`turn/start`&&_params?.threadId&&!_params?.model?.startsWith?.(`cxp/`)){await _cxpPrepareTurn(_params.threadId)}",
  "try{return await _original(_method,_params,..._rest)}catch(_e){if(_local&&_method===`turn/start`&&_params?.threadId){_cxpRunning.delete(_params.threadId);globalThis.__cxpRestoreDefault?.()}throw _e}}}",
  // The manager fans notifications out through addNotificationCallback(methods, notify); notify receives {method, params}.
  "if(_manager&&!_manager.__cxpThreadAccountsInstalled&&typeof _manager.addNotificationCallback===`function`){_manager.__cxpThreadAccountsInstalled=!0;",
  "_manager.addNotificationCallback([`turn/completed`,`turn/failed`],_n=>{try{if(_manager!==globalThis.__cxpClients?.local)return;_cxpRunning.delete(_n?.params?.threadId);if(_cxpRunning.size===0)globalThis.__cxpRestoreDefault?.()}catch{}})}};",
  "})();"
].join("\n");

const THREAD_PATTERN = `\\{activeThreadId:(${NAME})\\}=(${NAME});`;

export default {
  id: "093-thread-account",
  description: "Publish the open thread id and run each chat's turns on its pinned account",
  glob: "webview/assets/app-*.js",
  select: managerSelector,
  marker: MARKER,
  apply(source) {
    const patched = afterManagerInitialized(source, `globalThis.${MARKER}?.(this.requestClient,this)`);
    return `${helpers}\n${patched}`;
  }
};

export const publicationPatch = {
  id: '097-active-thread',
  description: 'Publish the selected thread from the layout chunk',
  glob: 'webview/assets/app-initial-*.js',
  marker: '/*__cxpActiveThreadPublication*/',
  apply(source) {
    const [anchor, id] = matchOnce(source, THREAD_PATTERN, 'main layout activeThreadId prop');
    return replaceOnce(source, anchor, anchor + `/*__cxpActiveThreadPublication*/globalThis.__cxpPublishThread?.(${id});`);
  }
};
