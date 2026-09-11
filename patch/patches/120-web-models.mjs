import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

const NAME = "[A-Za-z_$][\\w$]*";
const HELPER = "globalThis.__cxpWebRowsV2";
const PATTERN =
  `let\\{request:(${NAME}),promise:(${NAME})\\}=this\\.createRequest\\((${NAME}),(${NAME}),(${NAME}),(${NAME})\\);`;

const efforts = [
  { reasoningEffort: "low", description: "ChatGPT Web Instant" },
  { reasoningEffort: "medium", description: "ChatGPT Web Medium" },
  { reasoningEffort: "high", description: "ChatGPT Web High" },
  { reasoningEffort: "xhigh", description: "ChatGPT Web Extra High (account-gated)" },
  { reasoningEffort: "ultra", description: "ChatGPT Web Pro (account-gated)" },
];

const helpers = [
  ";(()=>{",

  "globalThis.__cxpGateway=()=>{",
  "try{const _value=globalThis.__codexpp?.gatewayRoute?.();",
  "if(typeof _value===`string`)return{baseUrl:_value,generation:0,ready:!!_value,models:[]};",
  "return _value&&typeof _value===`object`?_value:{baseUrl:null,generation:0,ready:!1,models:[]}}",
  "catch{return{baseUrl:null,generation:0,ready:!1,models:[]}}};",

  `${HELPER}=(_rows,_specs)=>{`,
  "const _template=_rows.find(_row=>!_row.hidden)??_rows[0];",
  "if(!_template||!Array.isArray(_specs))return[];",
  "return _specs.filter(_spec=>typeof _spec?.slug===`string`&&!_rows.some(_row=>_row.model===_spec.slug))",
  ".map(_spec=>({...structuredClone(_template),",
  "id:_spec.slug,model:_spec.slug,displayName:_spec.label,description:_spec.description,",
  `supportedReasoningEfforts:${JSON.stringify(efforts)},`,
  "defaultReasoningEffort:`high`,additionalSpeedTiers:[],serviceTiers:[],defaultServiceTier:null,",
  "hidden:!1,isDefault:!1,upgrade:null,upgradeInfo:null,availabilityNux:null}))};",

  "globalThis.__cxpParams=(_method,_params,_client)=>{",
  "if(_method===`turn/interrupt`&&_client?.hostId===`local`)globalThis.__codexpp?.webCancel?.(_params?.threadId,_params?.turnId)?.catch(()=>{});",
  "if(![`thread/start`,`thread/resume`,`thread/fork`].includes(_method))return _params;",
  "const _model=_params?.model??_params?.config?.model??null;",
  "const _web=typeof _model===`string`&&_model.startsWith(`chatgpt-web/`);",
  "if(_client?.hostId!==`local`){if(_web)throw new Error(`ChatGPT Web is local-only; no loopback route can be sent to a remote host`);return _params}",
  "if(typeof _model===`string`&&_model.startsWith(`cxp/`))return _params;",
  "const _gateway=globalThis.__cxpGateway();if(!_gateway.ready||!_gateway.baseUrl){",
  "if(typeof _model===`string`&&_model.startsWith(`chatgpt-web/`))throw new Error(`ChatGPT Web gateway is not ready; retry after the Codex++ hub starts`);",
  "return _params}",
  "if(_web&&!_gateway.supportedModels?.includes(_model))throw new Error(`ChatGPT Web model is unsupported: `+_model);",
  "if(_web&&!_gateway.catalogPath)throw new Error(_gateway.catalogError??`ChatGPT Web native tool catalog is not ready`);",
  "return{..._params,config:{..._params?.config,openai_base_url:_gateway.baseUrl}}};",

  "globalThis.__cxpResult=(_method,_promise)=>{",
  "if(_method!==`model/list`)return _promise;",
  "return _promise.then(async _res=>{let _gateway=globalThis.__cxpGateway();",
  "for(let _i=0;_i<30&&!_gateway.ready;_i++){await new Promise(_resolve=>setTimeout(_resolve,100));_gateway=globalThis.__cxpGateway()}",
  "if(!_gateway.ready||!Array.isArray(_res?.data))return _res;",
  `const _extra=${HELPER}(_res.data,_gateway.models);`,
  "return _extra.length?{..._res,data:[..._res.data,..._extra]}:_res});};",

  "})();",
].join("\n");

export default {
  id: "120-web-models",
  description: "Route local start/resume/fork through the generation-aware gateway and append its Web catalog",
  glob: "webview/assets/app-initial-*.js",
  marker: HELPER,
  apply(source) {
    const [anchor, request, promise, method, params, options, extra] = matchOnce(
      source,
      PATTERN,
      "app-server createRequest call",
    );
    const patched = replaceOnce(
      source,
      anchor,
      `let{request:${request},promise:__cxpPending}=this.createRequest(`
        + `${method},globalThis.__cxpParams(${method},${params},this),${options},${extra}),`
        + `${promise}=globalThis.__cxpResult(${method},__cxpPending);`,
    );
    return `${helpers}\n${patched}`;
  },
};
