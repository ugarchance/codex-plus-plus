import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

const NAME = "[A-Za-z_$][\\w$]*";
const HELPER = "globalThis.__cxpWebRows";

const PATTERN =
  `let\\{request:(${NAME}),promise:(${NAME})\\}=this\\.createRequest\\((${NAME}),(${NAME}),(${NAME}),(${NAME})\\);`;

const WEB_MODELS = [
  { slug: "chatgpt-web/pro", label: "ChatGPT Web — Pro", description: "ChatGPT Pro through a temporary web chat. No local tools." },
  { slug: "chatgpt-web/pro-harness", label: "ChatGPT Web — Pro (Harness)", description: "ChatGPT Pro in a normal web chat that can run Codex tools on this machine." }
];

const helpers = [
  ";(()=>{",

  "globalThis.__cxpRoute=()=>{",
  "if(globalThis.__cxpRouteValue!==undefined)return globalThis.__cxpRouteValue;",
  "try{globalThis.__cxpRouteValue=globalThis.__codexpp?.gatewayRoute?.()??null}",
  "catch{globalThis.__cxpRouteValue=null}",
  "return globalThis.__cxpRouteValue};",

  `${HELPER}=_rows=>{`,
  "const _template=_rows.find(_row=>!_row.hidden)??_rows[0];",
  "if(!_template)return[];",
  `const _specs=${JSON.stringify(WEB_MODELS)};`,
  "return _specs",
  ".filter(_spec=>!_rows.some(_row=>_row.model===_spec.slug))",
  ".map(_spec=>({...structuredClone(_template),",
  "id:_spec.slug,model:_spec.slug,displayName:_spec.label,description:_spec.description,",
  "supportedReasoningEfforts:[{reasoningEffort:`medium`,description:_spec.description}],",
  "defaultReasoningEffort:`medium`,",
  "additionalSpeedTiers:[],serviceTiers:[],defaultServiceTier:null,",
  "hidden:!1,isDefault:!1,upgrade:null,upgradeInfo:null,availabilityNux:null}))};",

  "globalThis.__cxpParams=(_method,_params)=>{",
  "if(_method!==`thread/start`)return _params;",
  "const _route=globalThis.__cxpRoute();",
  "if(!_route)return _params;",
  "return{..._params,config:{..._params?.config,openai_base_url:_route,",
  "features:{..._params?.config?.features,code_mode:!0,code_mode_only:!0}}}};",

  "globalThis.__cxpResult=(_method,_promise)=>{",
  "if(_method!==`model/list`||!globalThis.__cxpRoute())return _promise;",
  "return _promise.then(_res=>{",
  "if(!Array.isArray(_res?.data))return _res;",
  `const _extra=${HELPER}(_res.data);`,
  "return _extra.length?{..._res,data:[..._res.data,..._extra]}:_res",
  "}).catch(_err=>{throw _err})};",

  "})();"
].join("\n");

export default {
  id: "120-web-models",
  description: "Route each thread through the codexpp gateway and append the ChatGPT Web rows to model/list",
  glob: "webview/assets/app-initial-*.js",
  marker: HELPER,
  apply(source) {
    const [anchor, request, promise, method, params, options, extra] = matchOnce(
      source,
      PATTERN,
      "app-server createRequest call"
    );
    const patched = replaceOnce(
      source,
      anchor,
      `let{request:${request},promise:__cxpPending}=this.createRequest(` +
        `${method},globalThis.__cxpParams(${method},${params}),${options},${extra}),` +
        `${promise}=globalThis.__cxpResult(${method},__cxpPending);`
    );
    return `${helpers}\n${patched}`;
  }
};
