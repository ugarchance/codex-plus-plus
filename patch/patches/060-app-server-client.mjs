import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

const NAME = "[A-Za-z_$][\\w$]*";
const REGISTRY = "globalThis.__cxpClients";

const PATTERN =
  `does not match AppServerManager hostId \\$\\{${NAME}\\}\`\\);this\\.hostId=(${NAME}),`;
const ACCOUNT_READ_PATTERN =
  `async getAccount\\((${NAME})\\)\\{return this\\.sendRequest\\(\`account/read\`,\\{refreshToken:!1\\},\\1\\)\\}`;

const helpers = [
  ";(()=>{",

  "globalThis.__cxpSwitch=(_client,_credentials)=>_client.sendRequest(`account/login/start`,{",
  "type:`chatgptAuthTokens`,accessToken:_credentials.accessToken,",
  "chatgptAccountId:_credentials.chatgptAccountId,chatgptPlanType:_credentials.chatgptPlanType??null});",

  "globalThis.__cxpActivate=async(_id,_opts)=>{",
  "const _api=globalThis.__codexpp,_client=globalThis.__cxpClients?.local;",
  "if(!_api||!_client)return null;",
  "const _res=await _api.activate(_id,_opts);",
  "if(!_res?.ok)return null;",
  "await globalThis.__cxpSwitch(_client,_res.credentials);",
  "return _res.view};",

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
  "globalThis.__cxpRestored=!0;",
  "let _view;try{_view=globalThis.__codexpp?.accountsSync?.()}catch{return}",
  "const _want=_view?.defaultAccountId;",
  "if(!_want)return;",
  "for(let _attempt=0;_attempt<3;_attempt++){",
  "await(_attempt?new Promise(_done=>setTimeout(_done,1500*_attempt)):Promise.resolve());",
  "try{if(await globalThis.__cxpActivate(_want))return}catch{}",
  "}})();",

  "})();"
].join("\n");

export default {
  id: "060-app-server-client",
  description: "Register each AppServerManager and expose account switch/logout helpers",
  glob: "webview/assets/app-initial-*.js",
  marker: REGISTRY,
  apply(source) {
    const [anchor, hostId] = matchOnce(source, PATTERN, "AppServerManager constructor");
    const registered = replaceOnce(
      source,
      anchor,
      `${anchor}(${REGISTRY}??={})[${hostId}]=this,` +
        `${hostId}===\`local\`&&globalThis.__cxpRestore?.(this),`
    );
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
