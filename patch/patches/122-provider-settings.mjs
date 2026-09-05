import fs from 'node:fs';
import * as acorn from 'acorn';
import {functionAt,visit} from '../lib/ast.mjs';

const key = p => p.key?.name ?? p.key?.value;
const props = n => n?.type==='ObjectExpression' ? new Map(n.properties.map(p=>[key(p),p.value])) : new Map();
const ns = call => call.callee.expressions?.at(-1)?.object;
function one(items,label){if(items.length!==1)throw Error(label+': expected 1, found '+items.length);return items[0];}

export default {
 id:'122-provider-settings', description:'Render Providers below Analytics inside native Settings',
 glob:'webview/assets/settings-page-*.js',select:'settings.nav.clearHostFilter',marker:'cxp-provider-settings-entry',
 apply(source){
  const tree=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const nav=functionAt(source,'settings.nav.clearHostFilter');
  let navBindings;const rows=[];
  visit(nav,n=>{
   if(n.type==='ObjectPattern'&&n.properties.some(p=>key(p)==='settingsSections'))navBindings=new Map(n.properties.map(p=>[key(p),source.slice(p.value.start,p.value.end)]));
   if(n.type==='ReturnStatement'&&n.argument?.type==='CallExpression'&&n.argument.arguments[2]?.property?.name==='slug')rows.push(n.argument);
  });
  if(!navBindings)throw Error('Settings navigation prop contract missing');
  const row=one(rows,'Settings section row');const nativeRow=props(row.arguments[1]).get('children');
  const rowProps=props(nativeRow?.arguments?.[1]);if(!rowProps.has('isActive')||!rowProps.has('hideLabel'))throw Error('Settings row contract changed');
  const rowJsx=source.slice(ns(nativeRow).start,ns(nativeRow).end);
  const rowType=source.slice(nativeRow.arguments[0].start,nativeRow.arguments[0].end);
  const slug=source.slice(row.arguments[2].start,row.arguments[2].end);
  const active=navBindings.get('activeSection'),select=navBindings.get('onSelect');
  const extra=`(0,${rowJsx}.jsx)(${rowType},{'aria-label':'Providers','data-settings-panel-slug':'cxp-providers','data-cxp':'cxp-provider-settings-entry',icon:__cxpProviderIcon,isActive:${active}==='cxp-providers',hideLabel:${source.slice(rowProps.get('hideLabel').start,rowProps.get('hideLabel').end)},onClick:()=>${select}('cxp-providers'),weightClassName:'font-normal',label:'Providers'})`;
  const replacements=[{start:row.start,end:row.end,text:`(0,${rowJsx}.jsxs)(${rowJsx}.Fragment,{children:[${source.slice(row.start,row.end)},${slug}==='analytics'?${extra}:null]},${slug})`}];
  const visibility=[];
  visit(tree,(n,ancestors)=>{if(n.type==='VariableDeclarator'&&n.id?.type==='ObjectPattern'&&n.id.properties.some(p=>key(p)==='activeSettingsSection')&&n.init?.type==='CallExpression')visibility.push({node:n,fn:ancestors.findLast(a=>a.type==='FunctionDeclaration')});});
  const {node:v,fn:page}=one(visibility,'Settings route visibility');
  const section=v.init.arguments[0];if(section.type!=='Identifier')throw Error('Settings section argument changed');
  const original=source.slice(v.init.start,v.init.end);
  const transformed=original.slice(0,section.start-v.init.start)+`${section.name}==='cxp-providers'?'analytics':${section.name}`+original.slice(section.end-v.init.start);
  replacements.push({start:v.init.start,end:v.init.end,text:`__cxpProviderVisibility(${transformed},${section.name})`});
  const activeSection=source.slice(v.id.properties.find(p=>key(p)==='activeSettingsSection').value.start,v.id.properties.find(p=>key(p)==='activeSettingsSection').value.end);
  const suspense=[];
  visit(page,n=>{if(n.type==='CallExpression'&&n.arguments[0]?.type==='MemberExpression'&&n.arguments[0].property.name==='Suspense'&&props(n.arguments[1]).has('fallback'))suspense.push(n);});
  const content=one(suspense,'Settings route suspense');const outlet=props(content.arguments[1]).get('children');
  const react=source.slice(content.arguments[0].object.start,content.arguments[0].object.end);
  const jsx=source.slice(ns(content).start,ns(content).end);
  replacements.push({start:outlet.start,end:outlet.end,text:`${activeSection}==='cxp-providers'?(0,${jsx}.jsx)(__cxpProviderPage,{}):${source.slice(outlet.start,outlet.end)}`});
  // Keep embedded assets identical across Git checkouts using LF or CRLF.
  const readAsset=name=>fs.readFileSync(new URL('../../hub/'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const html=readAsset('providers.html').match(/<body>([\s\S]*?)<script/)[1].replace(/<small>CODEX\+\+<\/small>/,'');
  const css=readAsset('providers.css').replace(':root',':host').replace(/\bbody\s*\{/,'#cxp-provider-page {').replace('@media (max-width: 850px)','@container (max-width: 850px)');
  const ui=readAsset('providers-ui.js');
  const helpers=`
function __cxpProviderVisibility(result,section){return section==='cxp-providers'?{...result,activeSettingsSection:section,shouldRedirectToVisibleSettingsSection:false,shouldRenderRouteContent:true}:result;}
function __cxpProviderIcon(p){return (0,${jsx}.jsx)('svg',{...p,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.5,children:(0,${jsx}.jsx)('path',{d:'M9 3v4m6-4v4M6 7h12v2a6 6 0 0 1-6 6v6m-6-12a6 6 0 0 0 6 6'})});}
function __cxpProviderPage(){const host=(0,${react}.useRef)(null);(0,${react}.useEffect)(()=>{const root=host.current.shadowRoot??host.current.attachShadow({mode:'open'});root.innerHTML=${JSON.stringify('<style>'+css+':host{display:block;container-type:inline-size;background:transparent}header>div{display:block}header p{margin-top:4px}#editor{max-height:none;position:relative;top:0}</style><div id="cxp-provider-page">'+html+'</div>')};const nativeDocument=host.current.ownerDocument;const document={getElementById:id=>root.getElementById(id),querySelectorAll:s=>root.querySelectorAll(s),createElement:tag=>nativeDocument.createElement(tag)};const window={providers:globalThis.__cxpProviders};${ui}\n},[]);return (0,${jsx}.jsx)('div',{ref:host,'data-cxp':'providers-content',style:{width:'100%',height:'100%',minWidth:0,minHeight:0,overflowY:'auto',overscrollBehaviorY:'contain'}});}
`;
  let result=source;for(const edit of replacements.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);
  return helpers+'\n'+result;
 }
};
