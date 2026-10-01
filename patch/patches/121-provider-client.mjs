import { afterManagerInitialized, managerSelector } from "../lib/manager.mjs";
import * as acorn from "acorn";
import { visit } from "../lib/ast.mjs";
const N = "[A-Za-z_$][\\w$]*";
const helpers = `;(()=>{
 const api=globalThis.__cxpProviders;if(!api)return;
 const request=async(method,...args)=>{const r=await api.call(method,...args);if(!r?.ok)throw Error(r?.error??'Provider error');return r.data};
 globalThis.__cxpProviderCall=request;
 globalThis.__cxpInstallProviders=client=>{
  if(client.__cxpProviderInstalled)return;client.__cxpProviderInstalled=true;
  const original=client.sendRequest.bind(client);
  client.sendRequest=async(method,params,...rest)=>{
   if(method==='model/list'){const result=await original(method,params,...rest);if(client.hostId!=='local')return result;const rows=await request('catalog');return {...result,data:[...result.data,...rows.filter(r=>!result.data.some(m=>m.model===r.model))]};}
   if(['thread/start','thread/resume','thread/fork'].includes(method)){
    let model=params?.model??params?.config?.model;let saved;if(!model&&params?.threadId){saved=await request('route',params.threadId);model=saved?.modelId;}
    if(!model&&method==='thread/start'){const read=await original('config/read',{cwd:params?.cwd,includeLayers:false});const config=read.config;model=(config?.profiles?.[config?.profile]?.model??config?.model);}
    if(model?.startsWith('cxp/')){
     if(client.hostId!=='local')throw Error('External providers are available in local chats.');
     const prepared=await request('prepare',model,method==='thread/resume'?params.threadId:null);
     const config={...params.config,...prepared.config};if(params.config?.model_reasoning_effort!=null)config.model_reasoning_effort=params.config.model_reasoning_effort;
     const result=await original(method,{...params,model,modelProvider:prepared.modelProvider,config},...rest);
     if(result.thread?.id)await request('bind',prepared.ticket,result.thread.id);return result;
    }
   }
   if(method==='turn/start'){const model=params?.collaborationMode?.settings?.model??params?.model;if(model){const route=await request('route',params.threadId);if(Boolean(route)!==model.startsWith('cxp/')||(route&&route.modelId.split('/')[1]!==model.split('/')[1]))throw Error('Start a new chat to switch providers.');}}
   return original(method,params,...rest);
  };
 };
 api.onNativeSelect(async({requestId,id})=>{let ok=false;try{ok=!!await globalThis.__cxpActivate(id)}finally{await request('native-selected',requestId,ok)}});
 api.onChange(()=>globalThis.dispatchEvent(new Event('cxp-providers-changed')));
})();`;
export default {
  id: "121-provider-client",
  description: "Merge external catalog and prepare per-thread provider routes",
  glob: "webview/assets/app-*.js",
  select: managerSelector,
  marker: "__cxpInstallProviders",
  apply(source) {
    return helpers + '\n' + afterManagerInitialized(source, 'globalThis.__cxpInstallProviders?.(this.requestClient)');
  },
};

export const catalogPatch = {
  id: '124-provider-catalog',
  description: 'Preserve the declared effort levels of external models in the renderer catalog',
  glob: 'webview/assets/app-initial-*.js',
  marker: '__cxpExternalCatalogModels',
  apply(source) {
    const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const normalizers = [];
    visit(ast, node => {
      if (node.type !== 'FunctionDeclaration' || node.params[0]?.type !== 'ObjectPattern') return;
      const keys = new Map(node.params[0].properties.map(p => [p.key?.name, p.value]));
      if (['models', 'enabledReasoningEfforts', 'hasConfiguredModelCatalog', 'useHiddenModels'].every(k => keys.has(k)))
        normalizers.push({ fn: node, models: keys.get('models') });
    });
    if (normalizers.length !== 1 || normalizers[0].models.type !== 'Identifier')
      throw Error('Provider catalog normalization contract is not unique');
    const { fn, models } = normalizers[0], outputs = [];
    visit(fn.body, node => {
      if (node.type !== 'ObjectExpression') return;
      const keys = new Map(node.properties.map(p => [p.key?.name, p.value]));
      if (['models', 'defaultModel', 'hasModelSupportingMaxReasoningEffort'].every(k => keys.has(k))) outputs.push(keys.get('models'));
    });
    if (outputs.length !== 1 || outputs[0].type !== 'Identifier')
      throw Error('Provider catalog output is not unique');
    const output = outputs[0];
    // Native feature flags must not remove provider-declared effort levels.
    const catalogEdits = [
      { start: fn.body.start + 1, end: fn.body.start + 1, text: `const __cxpExternalCatalogModels=${models.name}.filter(m=>m.model?.startsWith('cxp/'));` },
      { start: output.start, end: output.end, text: `[...${output.name}.filter(m=>!m.model?.startsWith('cxp/')),...__cxpExternalCatalogModels]` },
    ];
    for (const edit of catalogEdits.sort((a,b) => b.start - a.start))
      source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return source;
  },
};
