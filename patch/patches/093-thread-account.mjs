import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

/**
 * Patch 093: Per-chat account
 *
 * routing.json already records which account started each thread
 * (threadOwner, patch 090) but nothing consumed it. This patch
 * - publishes the selected thread id (`activeThreadId` prop of the main
 *   layout, computed from the route kind) as globalThis.__cxpActiveThreadId,
 *   null on the home / new-chat routes whose draft ids end in `new-conversation`,
 * - switches the engine to a thread's pinned account when that chat is
 *   selected and again before `turn/start` / `thread/resume` reach the local
 *   request client (one in-flight activation per thread), and
 * - exposes __cxpPinThread for the profile menu (patch 040): activate an
 *   account and record it as the owner of the open chat.
 * - applies a one-shot native model override to `thread/fork` when patch 095
 *   copies an external-provider chat back to ChatGPT (__cxpForkModel).
 * Threads routed to external providers (patch 121) are left alone.
 */

const NAME = "[A-Za-z_$][\\w$]*";
const MARKER = "__cxpInstallThreadAccounts";

export const helpers = [
  ";(()=>{",
  "globalThis.__cxpActiveThreadId??=null;",
  // Called from the main layout render: null for the home / side-panel drafts, and
  // when the open chat changes, move the engine to its pinned account right away.
  "globalThis.__cxpPublishThread=_id=>{const _next=typeof _id===`string`&&!_id.endsWith(`new-conversation`)?_id:null;if(_next===globalThis.__cxpActiveThreadId)return;globalThis.__cxpActiveThreadId=_next;if(_next)globalThis.__cxpFollowThread?.(_next).catch?.(()=>{})};",
  "globalThis.__cxpThreadOwner=_threadId=>{try{const _r=globalThis.__codexpp?.routingView?.();return(_threadId&&_r?.threadOwner?.[_threadId])||null}catch{return null}};",
  // Menu action: use this account for the open chat (and switch to it now).
  "globalThis.__cxpPinThread=async(_threadId,_accountId)=>{",
  "const _api=globalThis.__codexpp;if(!_api||!_accountId)return null;",
  "const _view=await globalThis.__cxpActivate?.(_accountId);",
  "if(_view&&_threadId){try{await _api.learnThreadOwner?.(_threadId,_accountId)}catch{}}",
  "return _view};",
  // Before a turn or a resume: follow the pinned owner when it is usable.
  "const _cxpFollowing=new Map;",
  "globalThis.__cxpFollowThread=_threadId=>{if(!_threadId)return Promise.resolve(null);if(_cxpFollowing.has(_threadId))return _cxpFollowing.get(_threadId);const _p=_cxpFollowOnce(_threadId).finally(()=>_cxpFollowing.delete(_threadId));_cxpFollowing.set(_threadId,_p);return _p};",
  "const _cxpFollowOnce=async _threadId=>{try{",
  "const _api=globalThis.__codexpp;if(!_api||!_threadId)return null;",
  "const _owner=globalThis.__cxpThreadOwner(_threadId);if(!_owner)return null;",
  "const _view=_api.accountsSync?.();if(!_view||_owner===_view.activeAccountId)return null;",
  "const _account=_view.accounts?.find(_a=>_a.id===_owner);if(!_account)return null;",
  "if(typeof _account.usedPercent===`number`&&_account.usedPercent>=100)return null;",
  "if(_api.routingView?.()?.learnedIneligible?.[_owner])return null;",
  "return await globalThis.__cxpActivate?.(_owner)",
  "}catch{return null}};",
  `globalThis.${MARKER}=_client=>{`,
  "if(_client.__cxpThreadAccountsInstalled)return;_client.__cxpThreadAccountsInstalled=!0;",
  "const _original=_client.sendRequest.bind(_client);",
  "_client.sendRequest=async(_method,_params,..._rest)=>{",
  // "Continue with ChatGPT (copy)" (patch 095) forks an external-provider thread with a native model.
  "if(_method===`thread/fork`&&globalThis.__cxpForkModel){_params={..._params,model:globalThis.__cxpForkModel};globalThis.__cxpForkModel=null}",
  "if((_method===`turn/start`||_method===`thread/resume`)&&_params?.threadId&&!_params?.model?.startsWith?.(`cxp/`)&&_client===globalThis.__cxpClients?.local?.requestClient)await globalThis.__cxpFollowThread(_params.threadId);",
  "return _original(_method,_params,..._rest)}};",
  "})();"
].join("\n");

const THREAD_PATTERN = `\\{activeThreadId:(${NAME})\\}=(${NAME});`;
const CLIENT_PATTERN = `this\\.requestClient=(${NAME});let (${NAME})=this\\.settings\\.restricted;`;

export default {
  id: "093-thread-account",
  description: "Publish the open thread id and keep each chat on its pinned account",
  glob: "webview/assets/app-initial-*.js",
  marker: MARKER,
  apply(source) {
    const [threadAnchor, threadId] = matchOnce(source, THREAD_PATTERN, "main layout activeThreadId prop");
    // The home and side-panel routes carry the draft ids `new-conversation` /
    // `panel-new-conversation` (see the entrypoint helper); those are not threads.
    let patched = replaceOnce(source, threadAnchor, `${threadAnchor}globalThis.__cxpPublishThread?.(${threadId});`);
    const [clientAnchor, client] = matchOnce(patched, CLIENT_PATTERN, "AppServerManager request client");
    patched = replaceOnce(patched, clientAnchor, `${clientAnchor}globalThis.${MARKER}?.(${client});`);
    return `${helpers}\n${patched}`;
  }
};
