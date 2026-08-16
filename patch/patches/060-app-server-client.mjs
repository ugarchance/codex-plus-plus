import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

const NAME = "[A-Za-z_$][\\w$]*";
const REGISTRY = "globalThis.__cxpClients";

const PATTERN =
  `does not match AppServerManager hostId \\$\\{${NAME}\\}\`\\);this\\.hostId=(${NAME}),`;

const helpers = [
  ";(()=>{",

  "globalThis.__cxpSwitch=(_client,_credentials)=>_client.sendRequest(`account/login/start`,{",
  "type:`chatgptAuthTokens`,accessToken:_credentials.accessToken,",
  "chatgptAccountId:_credentials.chatgptAccountId,chatgptPlanType:_credentials.chatgptPlanType??null});",

  "globalThis.__cxpActivate=async _id=>{",
  "const _api=globalThis.__codexpp,_client=globalThis.__cxpClients?.local;",
  "if(!_api||!_client)return null;",
  "const _res=await _api.activate(_id);",
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

  "globalThis.__cxpRestore=async _client=>{",
  "if(globalThis.__cxpRestored)return;",
  "globalThis.__cxpRestored=!0;",
  "let _view;try{_view=globalThis.__codexpp?.accountsSync?.()}catch{return}",
  "const _want=_view?.defaultAccountId;",
  "if(!_want||_want===_view.activeAccountId)return;",
  "for(let _attempt=0;_attempt<3;_attempt++){",
  "await new Promise(_done=>setTimeout(_done,1500*(_attempt+1)));",
  "try{if(await globalThis.__cxpActivate(_want))return}catch{}",
  "}};",

  "})();"
].join("\n");

export default {
  id: "060-app-server-client",
  description: "Register each AppServerManager and expose account switch/logout helpers",
  glob: "webview/assets/app-initial-*.js",
  marker: REGISTRY,
  apply(source) {
    const [anchor, hostId] = matchOnce(source, PATTERN, "AppServerManager constructor");
    const hooked = replaceOnce(
      source,
      anchor,
      `${anchor}(${REGISTRY}??={})[${hostId}]=this,` +
        `${hostId}===\`local\`&&globalThis.__cxpRestore?.(this),`
    );
    return `${helpers}\n${hooked}`;
  }
};
