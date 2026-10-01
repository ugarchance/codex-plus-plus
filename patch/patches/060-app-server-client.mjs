import { matchOnce, replaceOnce } from "../lib/anchor.mjs";
import { afterManagerInitialized, managerSelector } from "../lib/manager.mjs";
import { visit } from "../lib/ast.mjs";
import * as acorn from "acorn";

const NAME = "[A-Za-z_$][\\w$]*";
const REGISTRY = "globalThis.__cxpClients";

const ACCOUNT_READ_PATTERN =
  `async getAccount\\((${NAME})\\)\\{return this\\.sendRequest\\(\`account/read\`,\\{refreshToken:!1\\},\\1\\)\\}`;

const helpers = [
  ";(()=>{",

  // Account changes replace the native reactive scope. Responses must still
  // settle the transport that created the request, including a turn already
  // admitted just before the scope changed.
  "const _responseOwners=new Map,_responsePrototypes=new WeakSet;",
  "globalThis.__cxpInstallResponseOwners=_client=>{if(!_client)return;const _proto=Object.getPrototypeOf(_client);if(!_proto||_responsePrototypes.has(_proto)||typeof _proto.createRequest!==`function`||typeof _proto.onResult!==`function`||typeof _proto.onError!==`function`)return;_responsePrototypes.add(_proto);",
  "const _create=_proto.createRequest;_proto.createRequest=function(..._args){const _request=_create.apply(this,_args),_key=JSON.stringify([this.hostId,_request.request.id]);_responseOwners.set(_key,this);const _clear=()=>{if(_responseOwners.get(_key)===this)_responseOwners.delete(_key)};_request.promise.then(_clear,_clear);return _request};",
  "for(const _name of [`onResult`,`onError`]){const _original=_proto[_name];_proto[_name]=function(_id,..._args){const _key=JSON.stringify([this.hostId,_id]),_owner=_responseOwners.get(_key);_responseOwners.delete(_key);return _original.call(_owner??this,_id,..._args)}}};",

  "let _chatToRestore=null;",
  "const _rememberChat=()=>{const _thread=globalThis.__cxpActiveThreadId,_navigate=globalThis.__cxpNavigation?.navigate;if(!_thread||!_navigate)return null;const _saved={thread:_thread,navigate:_navigate};_chatToRestore=_saved;setTimeout(()=>{if(_chatToRestore===_saved)_chatToRestore=null},10000);return _saved};",
  "globalThis.__cxpInstallNavigation=(_navigation,_pathname)=>{globalThis.__cxpNavigation=_navigation;const _saved=_chatToRestore;if(!_saved||_navigation.navigate===_saved.navigate)return;_chatToRestore=null;if(_pathname===`/`)Promise.resolve().then(()=>_navigation.navigateToLocalConversation(_saved.thread))};",

  // Do not run queue reads/writes inside the native reactive watch's dependency
  // collection. It would subscribe itself to its own UI notifications.
  "globalThis.__cxpDeferredSubscription=(_subscribe,_listener)=>{let _active=true,_pending=false;const _stop=_subscribe(()=>{if(!_active||_pending)return;_pending=true;Promise.resolve().then(()=>{_pending=false;if(_active)_listener()})});return()=>{_active=false;_stop?.()}};",

  // A replacement coordinator can lose the shared start lock to its predecessor.
  // Native release does not notify the waiting coordinator. Wake it only after
  // the real owner releases the lock; never clear or bypass the native lock.
  "const _queueWaiters=new Set;",
  "globalThis.__cxpInstallQueueWake=_manager=>{const _queue=_manager.runtime?.queuedMessages;if(!_queue||_queue.__cxpWakeInstalled||typeof _queue.tryAcquireStartTurn!==`function`||typeof _queue.releaseStartTurn!==`function`)return;_queue.__cxpWakeInstalled=true;const _take=_queue.tryAcquireStartTurn,_release=_queue.releaseStartTurn;",
  "_queue.tryAcquireStartTurn=function(_thread,..._args){const _ok=_take.call(this,_thread,..._args);if(!_ok)_queueWaiters.add(JSON.stringify([_manager.hostId,_thread]));return _ok};",
  "_queue.releaseStartTurn=function(_thread,..._args){const _result=_release.call(this,_thread,..._args);if(_queueWaiters.delete(JSON.stringify([_manager.hostId,_thread])))Promise.resolve().then(()=>{const _current=globalThis.__cxpClients?.[_manager.hostId];if(_current&&!_current.disposed)_current.turnCoordinator?.executionChanged?.()});return _result}};",

  "globalThis.__cxpSwitch=(_client,_credentials)=>_client.sendRequest(`account/login/start`,{",
  "type:`chatgptAuthTokens`,accessToken:_credentials.accessToken,",
  "chatgptAccountId:_credentials.chatgptAccountId,chatgptPlanType:_credentials.chatgptPlanType??null});",

  "let _activation=Promise.resolve();",
  "globalThis.__cxpActivate=(_id,_opts)=>{const _run=async()=>{",
  "const _api=globalThis.__codexpp,_client=globalThis.__cxpClients?.local;",
  "if(!_api||!_client)return null;",
  "const _current=_api.accountsSync?.()?.activeAccountId;",
  "if((globalThis.__cxpRunningTurns?.size>0&&_current!==_id)||(globalThis.__cxpPendingTurnTarget&&globalThis.__cxpPendingTurnTarget!==_id))throw Error(`Another account has a running chat. Wait for it to finish before switching accounts.`);",
  "const _res=await _api.activate(_id,{prepare:true});",
  "if(!_res?.ok)return null;",
  "globalThis.__cxpConfirmedAccountId=null;",
  "const _savedChat=_rememberChat();try{await globalThis.__cxpSwitch(_client,_res.credentials)}catch(_error){if(_chatToRestore===_savedChat)_chatToRestore=null;throw _error}",
  "const _committed=await _api.activate(_id,{commit:true,transient:_opts?.transient===true});",
  "if(!_committed?.ok)throw Error(`The account switch could not be saved. Try again.`);",
  "globalThis.__cxpConfirmedAccountId=_id;return _committed.view};",
  "const _result=_activation.then(_run,_run);_activation=_result.catch(()=>null);return _result};",

  "globalThis.__cxpSignOut=async(_id,_original)=>{",
  "const _api=globalThis.__codexpp,_client=globalThis.__cxpClients?.local;",
  "const _fallback=_original??(()=>_client?.logout?.());",
  "if(!_api)return _fallback();",
  "const _plan=await _api.logoutPlan(_id);",
  "if(!_plan?.ok)return _fallback();",
  "if(_plan.signOut){await _api.logoutCommit(_id,null);return _fallback()}",
  "if(_plan.credentials&&_client)await globalThis.__cxpSwitch(_client,_plan.credentials);",
  "return _api.logoutCommit(_id,_plan.next)};",

  "globalThis.__cxpLogOut=_original=>()=>{",
  "let _view;try{_view=globalThis.__codexpp?.accountsSync?.()}catch{}",
  "const _id=_view?.activeAccountId;",
  "return _id?globalThis.__cxpSignOut(_id,_original):_original?.()};",

  "globalThis.__cxpRestore=_client=>globalThis.__cxpRestorePromise??=(async()=>{",
  "if(globalThis.location?.pathname?.endsWith(`/detached-window.html`)||/[?&]initialRoute=(?:%2F|\\/)avatar-overlay(?:&|$)/i.test(globalThis.location?.search??``))return;",
  "globalThis.__cxpRestored=!0;",
  "let _view;try{_view=globalThis.__codexpp?.accountsSync?.()}catch{return}",
  "const _want=_view?.defaultAccountId;",
  "if(!_want)return;",
  "for(let _attempt=0;_attempt<3;_attempt++){",
  "await(_attempt?new Promise(_done=>setTimeout(_done,1500*_attempt)):Promise.resolve());",
  "try{if(await globalThis.__cxpActivate(_want))return}catch{}",
  "}})();",

  // React can construct managers which never receive responses. Keep the first
  // live manager until actual request/notification traffic identifies its successor.
  "globalThis.__cxpRegisterClient=_manager=>{const _all=globalThis.__cxpClients??={};",
  "const _select=()=>{if(!_manager.disposed)_all[_manager.hostId]=_manager};",
  "if(!_all[_manager.hostId]||_all[_manager.hostId].disposed)_select();",
  "if(!_manager.__cxpRegistryInstalled){_manager.__cxpRegistryInstalled=true;for(const _name of [`sendRequest`,`onNotification`]){const _original=_manager[_name];if(typeof _original===`function`)_manager[_name]=function(..._args){_select();return _original.apply(this,_args)}}}",
  "if(_manager.hostId===`local`&&_all.local===_manager)globalThis.__cxpRestore?.(_manager)};",
  "globalThis.__cxpBindClients=(_manager,_getManagers)=>{const _all=globalThis.__cxpClients??={};Object.defineProperty(_all,_manager.hostId,{configurable:true,get:()=>{try{return _getManagers?.()?.find(_m=>_m.hostId===_manager.hostId)??_manager}catch{return _manager}}});if(_manager.hostId===`local`)Promise.resolve().then(()=>globalThis.__cxpRestore?.(_all.local))};",

  "})();"
].join("\n");

export default {
  id: "060-app-server-client",
  description: "Register each AppServerManager and expose account switch/logout helpers",
  glob: "webview/assets/app-*.js",
  select: managerSelector,
  marker: REGISTRY,
  apply(source) {
    const factoryPattern = `manager:(${NAME}),getManagers:(${NAME}),readLatestImageEditTurnState:`;
    let registered;
    if (source.includes('readLatestImageEditTurnState:')) {
      const ranges=new Map();
      visit(acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'}),(node,ancestors)=>{
        const value=node.type==='TemplateElement'?node.value.raw:node.type==='Literal'?node.value:null;
        if(value!=='Managed worktree archive coordination is unavailable.')return;
        const fn=ancestors.findLast(n=>n.type==='FunctionDeclaration');
        if(fn)ranges.set(fn.start,fn);
      });
      if(ranges.size!==1)throw Error(`Native manager factory: expected 1, found ${ranges.size}`);
      const range=[...ranges.values()][0];
      const factory = matchOnce(source.slice(range.start,range.end), factoryPattern, 'native manager registry binding');
      factory.index+=range.start;
      const insertion = factory[0].replace(`getManagers:${factory[2]}`, `getManagers:(globalThis.__cxpBindClients(${factory[1]},${factory[2]}),${factory[2]})`);
      registered = source.slice(0,factory.index)+insertion+source.slice(factory.index+factory[0].length);
    } else {
      registered = afterManagerInitialized(source, `globalThis.__cxpRegisterClient(this)`);
    }
    registered = afterManagerInitialized(registered, `globalThis.__cxpInstallResponseOwners(this.requestClient);globalThis.__cxpInstallQueueWake(this)`);
    // Object spread snapshots this upstream readiness getter before the engine
    // version arrives. Keep the live getter so follow-up messages can drain.
    if (source.includes('Failed to initialize queued message execution')) {
      const readiness=matchOnce(registered, `return\\{\\.\\.\\.(${NAME})\\.queuedMessages,prepare:`, 'queued execution readiness');
      const replacement=`return{...${readiness[1]}.queuedMessages,get automaticExecutionEnabled(){return ${readiness[1]}.queuedMessages.automaticExecutionEnabled},prepare:`;
      registered=registered.slice(0,readiness.index)+replacement+registered.slice(readiness.index+readiness[0].length);
    }
    if (source.includes('Global-state updates require an app scope')) {
      const subscriptions=[];
      visit(acorn.parse(registered,{ecmaVersion:'latest',sourceType:'module'}),node=>{
        if(node.type==='Property'&&node.key?.name==='subscribeQueuedFollowUps')subscriptions.push(node);
      });
      if(subscriptions.length!==1)throw Error(`Queued follow-up subscription: expected 1, found ${subscriptions.length}`);
      const arrow=subscriptions[0].value.alternate;
      if(arrow?.type!=='ArrowFunctionExpression'||arrow.params.length!==1||arrow.params[0].type!=='Identifier'||arrow.body.type!=='CallExpression'||arrow.body.callee.property?.name!=='watch')throw Error('Unexpected queued follow-up watch contract');
      const listener=arrow.params[0].name,body=registered.slice(arrow.body.start,arrow.body.end);
      const callback=matchOnce(body,`${listener.replace(/[$]/g,'\\$')}\\(\\)`,'queued follow-up listener');
      const deferred=body.slice(0,callback.index)+'_cxpNotify()'+body.slice(callback.index+callback[0].length);
      registered=registered.slice(0,arrow.body.start)+`globalThis.__cxpDeferredSubscription(_cxpNotify=>${deferred},${listener})`+registered.slice(arrow.body.end);
    }
    const [accountRead, accountArg] = matchOnce(
      registered,
      ACCOUNT_READ_PATTERN,
      "account/read method"
    );
    const hooked = replaceOnce(
      registered,
      accountRead,
      `async getAccount(${accountArg}){` +
        `return await(globalThis.__cxpRestorePromise??Promise.resolve()),` +
        `this.sendRequest(\`account/read\`,{refreshToken:!1},${accountArg})}`
    );
    return `${helpers}\n${hooked}`;
  }
};
