import { matchOnce } from "../lib/anchor.mjs";
const N = "[A-Za-z_$][\\w$]*";
const helpers = `;(()=>{
 const api=globalThis.__cxpProviders;if(!api)return;
 const request=async(method,...args)=>{const r=await api.call(method,...args);if(!r?.ok)throw Error(r?.error??'Provider error');return r.data};
 globalThis.__cxpProviderCall=request;
 globalThis.__cxpInstallProviders=client=>{
  if(client.__cxpProviderInstalled)return;client.__cxpProviderInstalled=true;
  const original=client.sendRequest.bind(client);
  client.sendRequest=async(method,params,...rest)=>{
   if(method==='model/list'){const result=await original(method,params,...rest);const rows=await request('catalog');return {...result,data:[...result.data,...rows.filter(r=>!result.data.some(m=>m.model===r.model))]};}
   if(['thread/start','thread/resume','thread/fork'].includes(method)){
    let model=params?.model;let saved;if(!model&&params?.threadId){saved=await request('route',params.threadId);model=saved?.modelId;}
    if(model?.startsWith('cxp/')){
     if(client.hostId!=='local')throw Error('External providers are available in local chats.');
     const prepared=await request('prepare',model,method==='thread/resume'?params.threadId:null);
     const result=await original(method,{...params,model,modelProvider:prepared.modelProvider,config:{...params.config,...prepared.config}},...rest);
     if(result.thread?.id)await request('bind',prepared.ticket,result.thread.id);return result;
    }
   }
   if(method==='turn/start'&&params?.model){const route=await request('route',params.threadId);if(Boolean(route)!==params.model.startsWith('cxp/')||(route&&route.modelId.split('/')[1]!==params.model.split('/')[1]))throw Error('Start a new chat to switch providers.');}
   return original(method,params,...rest);
  };
 };
 api.onNativeSelect(async({requestId,id})=>{let ok=false;try{ok=!!await globalThis.__cxpActivate(id)}finally{await request('native-selected',requestId,ok)}});
 api.onChange(()=>globalThis.dispatchEvent(new Event('cxp-providers-changed')));
})();`;
export default {
  id: "121-provider-client",
  description: "Merge external catalog and prepare per-thread provider routes",
  glob: "webview/assets/app-initial-*.js",
  marker: "__cxpInstallProviders",
  apply(source) {
    const anchor = matchOnce(
      source,
      `this\\.requestClient=(${N});let (${N})=this\\.settings\\.restricted;`,
      "AppServerManager request client",
    );
    return (
      helpers +
      "\n" +
      source.slice(0, anchor.index) +
      anchor[0] +
      `globalThis.__cxpInstallProviders?.(${anchor[1]});` +
      source.slice(anchor.index + anchor[0].length)
    );
  },
};
