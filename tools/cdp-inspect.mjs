#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import vm from 'node:vm';
const require = createRequire(import.meta.url);

const host = process.argv[2] ?? "127.0.0.1";
const port = Number(process.argv[3] ?? 19333);
const mode = process.argv[4] ?? "globals";

const targets = await fetch(`http://${host}:${port}/json`, { signal: AbortSignal.timeout(10000) }).then((response) => response.json());
const target = process.env.CXP_CDP_SURFACE === "web"
  ? targets.find((item) => item.type === "page" && new URL(item.url).origin === "https://chatgpt.com" && (!process.env.CXP_CDP_TARGET_ID || item.id===process.env.CXP_CDP_TARGET_ID))
  : targets.find((item) => item.type === "page" && item.url === "app://-/index.html")
  ?? targets.find((item) => item.type === "page" && item.url?.startsWith("app://") && !item.url.includes("avatar-overlay"));
if (!target?.webSocketDebuggerUrl) throw new Error("Codex app page target not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});

function command(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); socket.close(); reject(new Error(`CDP ${method} timed out after 30 seconds`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

if(mode==='web-owned-rollback-fixture') {
  if(process.env.CXP_CDP_SURFACE!=='web')throw Error('Requires the owned Web fixture');
  const web=require('../hub/web-session.cjs');
  const partialRecovery=process.argv[5]==='partial-01a090ba-c286-7831-8ac0-359ddb20b66d';
  if(partialRecovery) {
    await evaluate(`(()=>{const c=document.querySelector('#prompt-textarea'),o=window.__codexppComposerMutation,t=(${web.readComposerText.toString()})(c);
      if(!o||o.element!==c||o.url!==location.href||o.submitted||t.length!==201||o.imageNames.join()!=='image-1.png'||document.querySelector('[data-turn="user"],[data-testid="stop-button"]'))throw Error('Not the recorded 200-character unsent partial fixture');
      window.__codexppOwnedInsertion={element:c,url:location.href,before:'',prompt:t};return true})()`);
  } else if(process.argv[5]) {
    if(process.argv[5]!=='01a090a6-fb68-7b51-b9f8-5187d8a0d1dc')throw Error('Only the recorded failed fixture may be recovered');
    // Explicit cleanup of our recorded unsent test draft after it reappeared on
    // reload. This is not production lease recovery or permission to clear user drafts.
    await evaluate(`(()=>{const c=document.querySelector('#prompt-textarea'),text=(${web.readComposerText.toString()})(c),f=c?.closest('form');
      const a=text.indexOf('<codex_context_json>'),b=text.indexOf('</codex_context_json>'),p=JSON.parse(text.slice(a+20,b));
      if(text.length!==223742||p.codex_transport.logical_turn.turn_id!==${JSON.stringify(process.argv[5])}||!p.task_context.records.filter(r=>r.role==='user').at(-1)?.content.some(v=>v.text?.includes('K3-live-partial-6f29'))||document.querySelector('[data-turn="user"],[data-testid="stop-button"]'))throw Error('Recovered fixture did not match recorded identity and size');
      window.__codexppComposerMutation={element:c,url:location.href,submitted:false,mention:'',imageNames:[...f.querySelectorAll('[role="group"][aria-label]')].map(g=>g.getAttribute('aria-label')),pill:f.querySelector('[data-id^="plugin:"][data-keyword="Codex++ Native v2"]')};window.__codexppOwnedInsertion={element:c,url:location.href,before:'',prompt:text};return true})()`);
  }
  const proof=await evaluate(`(()=>{const p=(${web.ownedRollbackPlan.toString()})(${web.readComposerText.toString()});
    if(!p||(!${partialRecovery}&&!window.__codexppOwnedInsertion?.prompt.includes('K3-live-partial-6f29'))||document.querySelector('[data-turn="user"],[data-testid="stop-button"]'))return null;
    return {images:p.groups.length,pills:p.pills.length,removeLabels:p.groups.map(g=>[...g.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')))};})()`);
  if(!proof){console.log(JSON.stringify(await evaluate(`(()=>{const o=window.__codexppComposerMutation,i=window.__codexppOwnedInsertion,c=document.querySelector('#prompt-textarea'),f=c?.closest('form'),t=(${web.readComposerText.toString()})(c);return {owner:!!o,sameComposer:o?.element===c,sameUrl:o?.url===location.href,submitted:o?.submitted,inserted:!!i,sameInsertion:i?.element===c,attempted:i?.submissionAttempted,expectedLength:(i?.before+i?.prompt).length,actualLength:t?.length,prefix:(i?.before+i?.prompt).startsWith(t),imageNames:o?.imageNames,groups:[...f?.querySelectorAll('[role="group"][aria-label]')??[]].map(g=>({name:g.getAttribute('aria-label'),buttons:[...g.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'))})),pills:[...f?.querySelectorAll('[data-id^="plugin:"]')??[]].map(p=>({same:p===o?.pill,id:p.getAttribute('data-id')}))}})()`)));throw Error('Not the exact owned unsent fixture; preserved')}console.log(JSON.stringify(proof));
  let closePromise;
  const rollback=vm.runInNewContext('('+web.rollbackOwnedComposer.toString()+')',{
    evaluate,ownedRollbackPlan:web.ownedRollbackPlan,readComposerText:web.readComposerText,
    window:{focus:()=>{void command('Page.bringToFront')},isDestroyed:()=>false,destroy:()=>{closePromise=command('Page.close').catch(()=>{})},webContents:{focus(){},getURL:()=>target.url,loadURL:async url=>{await command('Page.navigate',{url});await new Promise(r=>setTimeout(r,500))}}},
    cleanupPointer:async(x,y)=>{await command('Page.bringToFront');const m=await command('Page.getLayoutMetrics'),z=m.cssVisualViewport?.zoom??m.visualViewport?.zoom??1;for(const type of ['mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,x:x*z,y:y*z,button:'left',clickCount:1})},
    key:async(name,mods=[])=>{for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key:name==='Return'?'Enter':name,code:name==='a'?'KeyA':name,windowsVirtualKeyCode:name==='a'?65:name==='Backspace'?8:13,modifiers:mods.includes('control')?2:mods.includes('meta')?4:0})},
    selectAllModifier:web.selectAllModifier,sleep:ms=>new Promise(r=>setTimeout(r,ms)),
    waitFor:async(expression)=>{const end=Date.now()+3000;while(Date.now()<end){if(await evaluate(expression))return true;await new Promise(r=>setTimeout(r,100))}throw Error('Owned fixture removal did not settle')}
  });
  console.log(JSON.stringify({cleaned:await rollback(),physicalCloseRequested:!!closePromise}));if(closePromise)await closePromise;
} else if (mode === 'web-draft-fixture-cleanup') {
  if (process.env.CXP_CDP_SURFACE !== 'web') throw Error('Requires the owned Web browser');
  console.log(JSON.stringify(await evaluate(`(()=>{
    const c=document.querySelector('#prompt-textarea');
    if(!c||!/^K3-owned-fixture-[a-f0-9-]{36}(?:-user-edit)?$/.test(c.textContent)||document.querySelector('[data-turn="user"],[data-testid="stop-button"]'))throw Error('Not the exact unsent K3 fixture');
    c.focus();const s=getSelection(),r=document.createRange();r.selectNodeContents(c);s.removeAllRanges();s.addRange(r);document.execCommand('delete',false);delete window.__codexppOwnedInsertion;
    return{cleared:c.textContent===''};
  })()`)));
} else if (mode === 'web-draft-regression') {
  if (process.env.CXP_CDP_SURFACE !== 'web') throw Error('Requires the owned Web browser');
  const web = require('../hub/web-session.cjs');
  console.log(JSON.stringify(await evaluate(`(()=>{try{
    const read=${web.readComposerText.toString()}, restore=${web.restoreOwnedInsertion.toString()}, verify=${web.verifyOwnedSubmission.toString()}, matches=${web.promptLanded.toString()};
    const c=document.querySelector('#prompt-textarea');
    if(!c||read(c)!==''||document.querySelector('[data-testid="stop-button"]')||c.querySelector('[data-id^="plugin:"]'))throw Error('Draft regression requires an idle empty composer without a connector pill');
    const prompt='K3-owned-fixture-'+crypto.randomUUID(), report={};
    const own=()=>window.__codexppOwnedInsertion={element:c,before:'',prompt,url:location.href};
    c.focus();own();document.execCommand('insertText',false,prompt.slice(0,12));
    report.partialRejected=!verify(prompt,read,matches);report.partialRestored=restore(read(c),read);
    if(!report.partialRestored)throw Error('Owned partial rollback failed; no further fixture input');
    own();document.execCommand('insertText',false,prompt);
    report.exactAccepted=verify(prompt,read,matches);
    const original=c,clone=c.cloneNode(true);original.replaceWith(clone);
    try{report.remountRejected=!verify(prompt,read,matches);report.remountPreserved=!restore(read(clone),read)&&read(clone)===prompt;}finally{clone.replaceWith(original);}
    own();window.__codexppOwnedInsertion.submissionAttempted=true;
    report.retryRejected=!verify(prompt,read,matches);report.attemptedDraftPreserved=!restore(read(c),read)&&read(c)===prompt;
    own();window.__codexppOwnedInsertion.url='https://chatgpt.com/c/another';report.navigationRejected=!verify(prompt,read,matches);
    own();c.focus();const s=getSelection(),r=document.createRange();r.selectNodeContents(c);r.collapse(false);s.removeAllRanges();s.addRange(r);
    document.execCommand('insertText',false,'-user-edit');report.userEditRejected=!verify(prompt,read,matches);report.userEditPreserved=!restore(read(c),read)&&read(c)===prompt+'-user-edit';
    if(read(c)!==prompt+'-user-edit')throw Error('Fixture changed externally; not cleared');
    c.focus();r.selectNodeContents(c);s.removeAllRanges();s.addRange(r);document.execCommand('delete',false);report.cleaned=read(c)==='';
    report.sent=0;return report;
    }catch(error){return{error:error.message}};
  })()`)));
} else if (mode === 'web-partial-insert-fixture') {
  if(process.env.CXP_CDP_SURFACE!=='web')throw Error('Requires the owned ChatGPT test browser');
  await command('Runtime.enable'); await command('Page.enable');
  const marker='K3-live-partial-6f29';
  const source=`(()=>{const original=document.execCommand.bind(document);let triggered=false,last='';
    const proof=()=>{if(!triggered)return;const c=document.querySelector('#prompt-textarea'),f=c?.closest('form');
      const value=JSON.stringify({partial:true,chars:c?.textContent?.length??0,images:f?.querySelectorAll('[role="group"][aria-label]').length??0,pills:f?.querySelectorAll('[data-id^="plugin:"]').length??0,users:document.querySelectorAll('[data-turn="user"]').length,stop:!!document.querySelector('[data-testid="stop-button"]')});if(value!==last){last=value;globalThis.__cxpPartialProof(value)}};
    document.execCommand=function(command,ui,value){if(!triggered&&command==='insertText'&&typeof value==='string'&&value.includes(${JSON.stringify(marker)})){triggered=true;const result=original(command,ui,value.slice(0,200));proof();return result}return original(command,ui,value)};
    const observer=new MutationObserver(proof);observer.observe(document,{childList:true,subtree:true});globalThis.__cxpRestorePartialProbe=()=>{document.execCommand=original;observer.disconnect()};globalThis.__cxpPartialProof(JSON.stringify({fixtureInstalled:true,path:location.pathname}));})()`;
  await command('Runtime.addBinding',{name:'__cxpPartialProof'});
  let closed=false,finish;
  const done=new Promise(resolve=>{finish=resolve});
  const listener=event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.bindingCalled'&&m.params.name==='__cxpPartialProof')console.log(m.params.payload)};
  socket.addEventListener('message',listener);socket.addEventListener('close',()=>{closed=true;finish()},{once:true});
  const script=await command('Page.addScriptToEvaluateOnNewDocument',{source});
  await evaluate(source); console.log(JSON.stringify({armed:true,marker,target:target.id}));
  const timer=setTimeout(finish,180000);await done;clearTimeout(timer);
  if(!closed){await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.identifier});await evaluate('globalThis.__cxpRestorePartialProbe?.()');await command('Runtime.removeBinding',{name:'__cxpPartialProof'})}
  socket.removeEventListener('message',listener);console.log(JSON.stringify({ownedDocumentClosed:closed}));
} else if (mode === 'web-observe-identities') {
  // Bounded read-only DOM measurement, never captures prompt text or credentials.
  await command('Runtime.enable'); await command('Page.enable');
  await command('Runtime.addBinding', { name: '__cxpIdentityMeasurement' });
  const listener = event => {
    const row = JSON.parse(event.data);
    if (row.method === 'Runtime.bindingCalled' && row.params.name === '__cxpIdentityMeasurement') console.log(row.params.payload);
  };
  socket.addEventListener('message', listener);
  const source = `(()=>{const start=()=>{let last='';const tick=()=>{const ids=s=>[...document.querySelectorAll(s)].map(e=>e.getAttribute('data-turn-id'));const state=JSON.stringify({path:location.pathname,users:ids('[data-turn="user"][data-turn-id]'),assistants:ids('[data-turn="assistant"][data-turn-id]'),stop:!!document.querySelector('[data-testid="stop-button"]')});if(state!==last){last=state;globalThis.__cxpIdentityMeasurement(state)}};const observer=new MutationObserver(tick);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-turn-id']});globalThis.__cxpStopIdentityMeasurement=()=>observer.disconnect();tick()};document.documentElement?start():addEventListener('DOMContentLoaded',start,{once:true})})()`;
  const script = await command('Page.addScriptToEvaluateOnNewDocument', { source });
  await evaluate(source);
  try { await new Promise(resolve => setTimeout(resolve, 55000)); }
  finally {
    await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier });
    await evaluate('globalThis.__cxpStopIdentityMeasurement?.()');
    await command('Runtime.removeBinding', { name: '__cxpIdentityMeasurement' });
    socket.removeEventListener('message', listener);
  }
} else if (mode === 'thread-open') {
  const threadId = process.argv[5];
  if (!/^[a-f0-9-]{36}$/.test(threadId ?? '')) throw new Error('Requires the observed test thread id');
  await evaluate(`globalThis.__cxpNavigation.navigateToLocalConversation(${JSON.stringify(threadId)})`);
  console.log(JSON.stringify({ opened: threadId }));
} else if (mode === 'cancel-owned-test') {
  const threadId=process.argv[5], turnId=process.argv[6];
  if(![threadId,turnId].every(x=>/^[a-f0-9-]{36}$/.test(x??'')))throw Error('Requires exact observed native test identities');
  console.log(JSON.stringify(await evaluate(`globalThis.__codexpp.webCancel(${JSON.stringify(threadId)},${JSON.stringify(turnId)})`)));
} else if (mode === 'thread-compact') {
  const threadId = process.argv[5];
  if (!/^[a-f0-9-]{36}$/.test(threadId ?? '')) throw new Error('Requires the observed test thread id');
  console.log(JSON.stringify(await evaluate(`(async()=>{
    const id=${JSON.stringify(threadId)};
    if(globalThis.__cxpActiveThreadId!==id)throw Error('Compaction requires the active observed test thread');
    if([...globalThis.__cxpRunningTurns??[]].length)throw Error('Compaction probe refuses an active turn');
    const {thread}=await globalThis.__cxpClients.local.sendRequest('thread/read',{threadId:id,includeTurns:false});
    if(thread.status?.type==='active')throw Error('Native engine still owns an active turn or compaction');
    if(![...document.querySelectorAll('button')].some(e=>e.innerText.includes('ChatGPT Web — Sol (Full)')))throw Error('Full model is not selected');
    await globalThis.__cxpClients.local.sendRequest('thread/compact/start',{threadId:id});
    return{requested:true,threadId:id,completionVerified:false};
  })()`)));
} else if (mode === 'web-submission-probe') {
  const web = require('../hub/web-session.cjs');
  console.log(JSON.stringify(await evaluate(`(()=>{const s=(${web.readTurnDomState.toString()})();try{const accepted=(${web.acceptedSubmission.toString()})({turnIds:[],assistantIds:[]},s);return{counts:[s.turnIds.length,s.userIds.length,s.assistantIds.length],emptyIds:s.turnIds.filter(x=>!x).length,accepted:!!accepted}}catch(e){return{counts:[s.turnIds.length,s.userIds.length,s.assistantIds.length],error:e.message}}})()`)));
} else if (mode === 'engine-web-config') {
  console.log(JSON.stringify(await evaluate(`(async()=>{const r=await globalThis.__cxpClients.local.sendRequest('config/read',{includeLayers:false});const c=r.config??{};return{catalog:c.model_catalog_json??null,provider:c.model_provider??null,context:c.model_context_window??null,features:c.features??null,agents:c.agents??null}})()`)));
} else if (mode === 'engine-web-models') {
  console.log(JSON.stringify(await evaluate(`(async()=>{const r=await globalThis.__cxpClients.local.sendRequest('model/list',{includeHidden:true,limit:100,cursor:null});return r.data.filter(x=>x.model?.startsWith('chatgpt-web/')).map(x=>({model:x.model,description:x.description,hidden:x.hidden}))})()`)));
} else if (mode === 'web-advertised') {
  console.log(JSON.stringify(await evaluate(`(()=>{const t=document.querySelector('[data-turn="user"]')?.textContent??'';const start=t.indexOf('<codex_context_json>')+20,end=t.indexOf('</codex_context_json>');const p=JSON.parse(t.slice(start,end).trim());return {inventory:p.task_context.advertised_native_tools}})()`)));
} else if (mode === 'web-draft-proof' || mode === 'clear-checkpoint-test-draft') {
  const { readComposerText } = require('../hub/web-session.cjs');
  const gatewaySource = fs.readFileSync(new URL('../hub/gateway.cjs', import.meta.url), 'utf8');
  const compactionSource = gatewaySource.slice(gatewaySource.indexOf('function compactionPrompt('), gatewaySource.indexOf('\nfunction runCompaction('));
  const frame = require('../hub/web-contract.cjs').compilePrompt({ input: [] }, { compaction: true, preflightBudget: false }).text.split('<codex_context_json>')[0];
  const prefix = new Function(compactionSource + ';return compactionPrompt')()({ text: frame });
  const proof = await evaluate(`(()=>{
    const c=document.querySelector('#prompt-textarea');if(!c)return{present:false};
    const text=(${readComposerText.toString()})(c),a=text.indexOf('<codex_context_json>'),b=text.indexOf('</codex_context_json>');
    let payload;try{payload=JSON.parse(text.slice(a+20,b).trim())}catch{}
    const expected=payload?${JSON.stringify(prefix)}+'<codex_context_json>\\n'+JSON.stringify(payload)+'\\n</codex_context_json>':'';
    let mismatch=0;while(mismatch<expected.length&&text[mismatch]===expected[mismatch])mismatch++;
    return{chars:text.length,expectedChars:expected.length,firstMismatch:mismatch,expectedCodes:[...expected.slice(Math.max(0,mismatch-3),mismatch+4)].map(x=>x.codePointAt(0)),actualCodes:[...text.slice(Math.max(0,mismatch-3),mismatch+4)].map(x=>x.codePointAt(0)),checkpointIntro:text.startsWith('Create a concise context checkpoint'),jsonValid:!!payload,nativeToolsEnabled:payload?.codex_transport?.native_tools?.enabled,records:payload?.task_context?.records?.length,threadId:payload?.codex_transport?.logical_turn?.thread_id,users:document.querySelectorAll('[data-turn="user"]').length,stop:!!document.querySelector('[data-testid="stop-button"]')};
  })()`);
  console.log(JSON.stringify(proof));
  if (mode === 'clear-checkpoint-test-draft') {
    if (proof.threadId !== process.argv[5] || proof.chars !== Number(process.argv[6]) || proof.chars !== proof.expectedChars || proof.firstMismatch !== proof.chars || !proof.checkpointIntro || proof.nativeToolsEnabled !== false || proof.users !== 0 || proof.stop) throw new Error('Draft does not exactly match the observed unsent tool-free test checkpoint; not cleared');
    const doc = await command('DOM.getDocument');
    const { nodeId } = await command('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#prompt-textarea' });
    await command('DOM.focus', { nodeId });
    for (const type of ['keyDown','keyUp']) await command('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: process.platform === 'darwin' ? 4 : 2 });
    for (const type of ['keyDown','keyUp']) await command('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    console.log(JSON.stringify({ cleared: await evaluate(`document.querySelector('#prompt-textarea')?.textContent.trim()===''`) }));
  }
} else if (mode === 'web-intent-proof') {
  const expected = process.argv[5];
  if (!expected) throw new Error('An explicit fixture marker is required');
  console.log(JSON.stringify(await evaluate(`(()=>{
    const t=[...document.querySelectorAll('[data-turn="user"]')].at(-1)?.textContent??'';
    const a=t.indexOf('<codex_context_json>'),b=t.indexOf('</codex_context_json>');
    if(a<0||b<0)return{contextPresent:false};
    const records=JSON.parse(t.slice(a+20,b).trim()).task_context.records;
    const latest=records.filter(r=>r.role==='user').at(-1);
    const text=(Array.isArray(latest?.content)?latest.content:[]).map(p=>p.text??'').join('');
    const answer=[...document.querySelectorAll('[data-turn="assistant"] [data-message-author-role="assistant"] .markdown')].at(-1)?.innerText??'';
    return{contextPresent:true,latestUserChars:text.length,expectedInLatest:text.includes(${JSON.stringify(expected)}),expectedInContext:t.includes(${JSON.stringify(expected)}),roles:records.slice(-5).map(r=>r.role??r.type),answerChars:answer.length,fixtureCorrect:answer.includes('third-f70279e1')&&answer.includes('7319')};
  })()`)));
} else if (mode === 'web-context-shape') {
  console.log(JSON.stringify(await evaluate(`(()=>{const t=[...document.querySelectorAll('[data-turn="user"]')].at(-1)?.textContent??'';const a=t.indexOf('<codex_context_json>'),b=t.indexOf('</codex_context_json>');if(a<0||b<0)return{present:false};const records=JSON.parse(t.slice(a+20,b).trim()).task_context.records;return{count:records.length,records:records.map(r=>({type:r.type,role:r.role,phase:r.phase,keys:Object.keys(r),nullKeys:Object.keys(r).filter(k=>r[k]===null),content:Array.isArray(r.content)?r.content.map(p=>({type:p.type,keys:Object.keys(p),chars:p.text?.length})):undefined}))}})()`)));
} else if (mode === 'web-turn-proof') {
  console.log(JSON.stringify(await evaluate(`(async()=>{const t=[...document.querySelectorAll('[data-turn="user"]')].at(-1)?.textContent??'';const a=t.indexOf('<codex_context_json>'),b=t.indexOf('</codex_context_json>');if(a<0||b<0)return{present:false};const p=JSON.parse(t.slice(a+20,b).trim()),token=p.codex_transport.native_tools.turn_token;const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return{path:location.pathname,records:p.task_context.records.length,logical:p.codex_transport.logical_turn,tokenPresent:typeof token==='string'&&token.length>0,tokenFingerprint:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,12)}})()`)));
} else if (mode === 'web-metadata-shape') {
  console.log(JSON.stringify(await evaluate(`(()=>{const t=[...document.querySelectorAll('[data-turn="user"]')].at(-1)?.textContent??'';const a=t.indexOf('<codex_context_json>'),b=t.indexOf('</codex_context_json>');const records=JSON.parse(t.slice(a+20,b).trim()).task_context.records;return records.filter(r=>r.role==='assistant').map(r=>{const m=r.internal_chat_message_metadata_passthrough;return{phase:r.phase,kind:typeof m,keys:m&&typeof m==='object'?Object.keys(m):[],fieldTypes:m&&typeof m==='object'?Object.fromEntries(Object.entries(m).map(([k,v])=>[k,typeof v])):{},contentKinds:m?.content_item_kinds,length:typeof m==='string'?m.length:null}})})()`)));
} else if (mode === 'web-answer-bottom') {
  console.log(JSON.stringify(await evaluate(`(()=>{const e=[...document.querySelectorAll('[data-turn="assistant"] [data-message-author-role="assistant"] .markdown')].at(-1)?.lastElementChild;if(!e)return{scrolled:false};e.scrollIntoView({block:'end'});return{scrolled:true}})()`)));
} else if (mode === 'web-visible-progress') {
  console.log(JSON.stringify(await evaluate(`(()=>{
    const root=[...document.querySelectorAll('[data-turn="assistant"][data-turn-id]')].at(-1);
    const text=[...root?.querySelectorAll('[data-message-author-role="assistant"] .markdown')??[]].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.innerText??'').join('\\n');
    return{path:location.pathname,chars:text.length,hasCheckpointHeading:/checkpoint|handoff|özet|compaction/i.test(text.slice(0,250)),stop:!!document.querySelector('[data-testid="stop-button"]'),alerts:[...document.querySelectorAll('[role="alert"]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.innerText.slice(0,300))};
  })()`)));
} else if (mode === 'web-turn-shape') {
  console.log(JSON.stringify(await evaluate(`(()=>({path:location.pathname,turns:[...document.querySelectorAll('[data-turn-id]')].map(e=>({tag:e.tagName,role:e.getAttribute('data-turn'),hasId:!!e.getAttribute('data-turn-id'),containerMatches:e.closest('[data-turn-id-container]')?.getAttribute('data-turn-id-container')===e.getAttribute('data-turn-id'),user:e.querySelectorAll('[data-message-author-role="user"]').length,assistant:e.querySelectorAll('[data-message-author-role="assistant"]').length,markdowns:e.querySelectorAll('[data-message-author-role="assistant"] .markdown').length,terminalButtons:[...e.querySelectorAll('button[data-testid]')].map(b=>b.getAttribute('data-testid'))})),send:!!document.querySelector('[data-testid="send-button"]'),stop:!!document.querySelector('[data-testid="stop-button"]')}))()`)));
} else if (mode === 'thread-meta') {
  const threadId = process.argv[5];
  if (!/^[a-f0-9-]{36}$/.test(threadId ?? '')) throw new Error('Requires the observed test thread id');
  console.log(JSON.stringify(await evaluate(`(async()=>{const {thread}=await globalThis.__cxpClients.local.sendRequest('thread/read',{threadId:${JSON.stringify(threadId)},includeTurns:false});return{id:thread.id,cwd:thread.cwd,path:thread.path,modelProvider:thread.modelProvider,status:thread.status}})()`)));
} else if (mode === 'panels') {
  console.log(JSON.stringify(await evaluate(`(()=>[...document.querySelectorAll('[role="alert"],[data-sonner-toast],[aria-live]')].filter(e=>e.getBoundingClientRect().width).map(e=>e.innerText.slice(0,2000).replace(/cxp_[a-f0-9]{48}/g,'[turn-token]')))()`)));
} else if (mode === 'native-composer') {
  console.log(JSON.stringify(await evaluate(`(()=>({threadId:globalThis.__cxpActiveThreadId,controls:[...document.querySelectorAll('button,[contenteditable="true"],input,[role="menuitem"]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.x>300}).map(e=>{const r=e.getBoundingClientRect();return{tag:e.tagName,role:e.getAttribute('role'),editable:e.isContentEditable,id:e.id,aria:e.getAttribute('aria-label'),testId:e.getAttribute('data-testid'),text:e.isContentEditable?null:e.innerText?.slice(0,120),x:r.x+r.width/2,y:r.y+r.height/2}})}))()`)));
} else if (mode === 'web-preflight') {
  console.log(JSON.stringify(await evaluate(`(async()=>{
    const api=globalThis.__codexpp, route=api?.gatewayRoute?.();
    const running=[...globalThis.__cxpRunningTurns??[]];
    const threads=await Promise.all(running.map(async threadId=>{try{const r=await globalThis.__cxpClients.local.sendRequest('thread/read',{threadId,includeTurns:false});return{id:threadId,status:r.thread.status}}catch{return{id:threadId,status:'unverified'}}}));
    return {running:threads, route:typeof route==='object'?{ready:route.ready,generation:route.generation,baseUrl:route.baseUrl,catalogReady:!!route.catalogPath,catalogError:route.catalogError}:route,webCancel:typeof api?.webCancel};
  })()`)));
} else if (mode === "web-controls") {
  console.log(JSON.stringify(await evaluate(`(() => ({
    url:location.href,
    composer:document.querySelectorAll('#prompt-textarea').length,
    send:document.querySelectorAll('[data-testid="send-button"]').length,
    mentions:[...document.querySelectorAll('[data-composer-plugin-impression-id]')].map(e=>({text:e.innerText,keyword:e.getAttribute('data-keyword')})),
    fileInputs:[...document.querySelectorAll('input[type="file"]')].map(e=>({testId:e.getAttribute('data-testid'),accept:e.accept})),
    menus:[...document.querySelectorAll('[role="menu"],[role="dialog"],[role="slider"]')].filter(e=>e.getBoundingClientRect().width).map(e=>({role:e.getAttribute('role'),text:e.innerText.slice(0,1800),min:e.getAttribute('aria-valuemin'),max:e.getAttribute('aria-valuemax'),now:e.getAttribute('aria-valuenow')})),
    menuControls:[...document.querySelectorAll('[role="menu"] button,[role="menu"] [role^="menuitem"],[role="menu"] [role="radio"]')].map(e=>({text:e.innerText,role:e.getAttribute('role'),checked:e.getAttribute('aria-checked'),pressed:e.getAttribute('aria-pressed'),state:e.getAttribute('data-state'),html:e.outerHTML.slice(0,1400)})),
    controls:[...document.querySelectorAll('main button,form button,#conversation-header-actions button,[data-testid="thread-header-right-actions"] button')].filter(e=>e.getBoundingClientRect().width).map(e=>{const r=e.getBoundingClientRect();return{testId:e.getAttribute('data-testid'),aria:e.getAttribute('aria-label'),text:e.innerText.slice(0,80),x:r.x+r.width/2,y:r.y+r.height/2}})
  }))()`)));
} else if (mode === "composer-shape") {
  const {readComposerText,promptLanded}=require('../hub/web-session.cjs');
  console.log(JSON.stringify(await evaluate(`(() => {
    const c=document.querySelector('#prompt-textarea'); if(!c)return {present:false};
    const a=c.innerText??'',b=c.textContent??'';
    const normalized=(${readComposerText.toString()})(c),start=normalized.indexOf('Continue the Codex task using'),candidate=normalized.slice(start),before=normalized.slice(0,start);
    let jsonValid=false;try{JSON.parse(candidate.split('<codex_context_json>\\n')[1].split('\\n</codex_context_json>')[0]);jsonValid=true}catch{}
    return {present:true,innerChars:a.length,textChars:b.length,normalizedChars:normalized.length,jsonValid,layoutMatches:(${promptLanded.toString()})(before,a,candidate),serializedMatches:(${promptLanded.toString()})(before,normalized,candidate),cr:(a.match(/\\r/g)||[]).length,lf:(a.match(/\\n/g)||[]).length,nbsp:(a.match(/\\u00a0/g)||[]).length,paragraphs:c.querySelectorAll('p').length,breaks:c.querySelectorAll('br').length,pills:[...c.querySelectorAll('[data-keyword]')].map(p=>({keyword:p.getAttribute('data-keyword'),chars:p.innerText?.length})),users:document.querySelectorAll('[data-message-author-role="user"]').length,assistants:document.querySelectorAll('[data-message-author-role="assistant"]').length,hasTransport:/cxp_[a-f0-9]{48}/.test(a),testMarker:a.includes('74b98d26'),focused:document.activeElement===c};
  })()`)));
} else if (mode === "thread-receipts") {
  const threadId = process.argv[5];
  if (!/^[a-f0-9-]{36}$/.test(threadId ?? "")) throw new Error("thread-receipts needs the observed test thread id");
  console.log(JSON.stringify(await evaluate(`(async () => {
    const {thread}=await globalThis.__cxpClients.local.sendRequest('thread/read',{threadId:${JSON.stringify(threadId)},includeTurns:true});
    const clean=s=>typeof s==='string'?s.replace(/cxp_[a-f0-9]{48}/g,'[turn-token]').replace(/(?:sk-|Bearer\\s+)[A-Za-z0-9_.-]+/g,'[redacted]'):s;
    return {id:thread.id,cwd:thread.cwd,path:thread.path,modelProvider:thread.modelProvider,status:thread.status,turns:thread.turns.map(t=>({id:t.id,status:t.status,error:clean(t.error?.message),items:t.items.filter(i=>i.type!=='reasoning').map(i=>({id:i.id,type:i.type,status:i.status,name:i.name,tool:i.tool,server:i.server,keys:Object.keys(i),exitCode:i.exitCode,text:i.type==='agentMessage'?clean(i.text)?.slice(0,2500):undefined}))}))};
  })()`)));
} else if (mode === "sandbox-file-probe") {
  const cwd = process.argv[5];
  if (!cwd || !fs.statSync(cwd).isDirectory() || !/codexpp-live-[a-z0-9]+$/i.test(cwd)) throw new Error("sandbox-file-probe requires the dedicated temporary live-test directory");
  const nonce = randomUUID();
  const outside = fs.mkdtempSync(path.join(path.dirname(cwd), "codexpp-denied-"));
  const insideFile = path.join(cwd, `native-${nonce}.txt`);
  const outsideFile = path.join(outside, "must-not-exist.txt");
  const q = value => "'" + value.replaceAll("'", "''") + "'";
  const script = `$ErrorActionPreference='Stop'; [IO.File]::WriteAllText(${q(insideFile)},${q(nonce)}); $denied=$false; try { [IO.File]::WriteAllText(${q(outsideFile)},'must-not-write') } catch [UnauthorizedAccessException] { $denied=$true }; [pscustomobject]@{insideWritten=$true;outsideDenied=$denied}|ConvertTo-Json -Compress; if(-not $denied){exit 23}`;
  const params = {
    command: [String(process.env.WINDIR ?? "C:\\Windows") + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], cwd,
    sandboxPolicy: { type: "workspaceWrite", writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true }, timeoutMs: 30000,
  };
  const result = await evaluate(`globalThis.__cxpClients.local.sendRequest("command/exec", ${JSON.stringify(params)})`);
  const receipt = { result, insideFile, insideMatches: fs.existsSync(insideFile) && fs.readFileSync(insideFile, "utf8") === nonce, outsideAbsent: !fs.existsSync(outsideFile) };
  console.log(JSON.stringify(receipt));
  if (result.exitCode !== 0 || !receipt.insideMatches || !receipt.outsideAbsent) process.exitCode = 1;
} else if (mode === "sandbox-probe") {
  const cwd = process.argv[5];
  if (!cwd || !fs.statSync(cwd).isDirectory() || !/codexpp-live-[a-z0-9]+$/i.test(cwd)) throw new Error("sandbox-probe requires the dedicated temporary live-test directory");
  const params = {
    command: [String(process.env.WINDIR ?? "C:\\Windows") + "\\System32\\whoami.exe"],
    cwd, sandboxPolicy: { type: "readOnly", networkAccess: false }, timeoutMs: 30000,
  };
  console.log(JSON.stringify(await evaluate(`globalThis.__cxpClients.local.sendRequest("command/exec", ${JSON.stringify(params)})`)));
} else if (mode === "sandbox-setup") {
  const cwd = process.argv[5];
  if (!cwd || !fs.statSync(cwd).isDirectory()) throw new Error("sandbox-setup requires an existing test directory");
  console.log(JSON.stringify(await evaluate(`(async () => {
    const client = globalThis.__cxpClients?.local;
    if (!client) throw new Error("No local app-server client");
    const session = await client.startWindowsSandboxSetup("elevated", ${JSON.stringify(cwd)});
    if (!session.started) return { started: false };
    let timer;
    try {
      return await Promise.race([session.completion, new Promise(resolve => {
        timer = setTimeout(() => resolve({ started: true, pending: true }), 45000);
      })]);
    } finally { clearTimeout(timer); }
  })()`)));
} else if (mode === "sandbox-status") {
  console.log(JSON.stringify(await evaluate(`(async () => {
    const client = globalThis.__cxpClients?.local;
    if (!client) throw new Error("No local app-server client");
    return client.sendRequest("windowsSandbox/readiness", {});
  })()`)));
} else if (mode === "observe") {
  await command("Network.enable");
  const failures = new Map();
  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Network.loadingFinished" && failures.has(message.params.requestId)) {
      const requestId = message.params.requestId;
      const result = failures.get(requestId);
      failures.delete(requestId);
      try {
        const body = JSON.parse((await command("Network.getResponseBody", { requestId })).body);
        result.errorKeys = Object.keys(body);
        result.detailKeys = body.detail && typeof body.detail === "object" ? Object.keys(body.detail) : [];
        const clean = value => typeof value === "string"
          ? value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_.-]+/g, "[redacted]").slice(0, 700)
          : value && typeof value === "object"
            ? Object.fromEntries(Object.entries(value).filter(([key]) => ["code", "type", "message", "detail", "error", "reason", "user_message", "developer_message", "error_code", "error_message"].includes(key)).map(([key, item]) => [key, clean(item)]))
            : value;
        result.error = clean(body);
      } catch (error) { result.captureError = error.message; }
      console.log(JSON.stringify(result));
      return;
    }
    if (message.method !== "Network.responseReceived") return;
    const { response, requestId } = message.params;
    const url = new URL(response.url);
    if (url.origin !== "https://chatgpt.com" || !url.pathname.startsWith("/backend-api/")) return;
    const result = { path: url.pathname, status: response.status };
    if (response.status >= 400) {
      failures.set(requestId, result);
    }
    console.log(JSON.stringify(result));
  });
  await new Promise(resolve => setTimeout(resolve, 45_000));
} else if (mode === "find-text") {
  console.log(JSON.stringify(await evaluate(`(() => [...document.querySelectorAll('*')].filter(e => (e.innerText??'').trim()===${JSON.stringify(process.argv[5])}).slice(-5).map(e => {
    const rows=[]; for(let i=0;e&&i<5;i++,e=e.parentElement){const r=e.getBoundingClientRect(),s=getComputedStyle(e);rows.push({tag:e.tagName,role:e.getAttribute('role'),aria:e.getAttribute('aria-label'),tabindex:e.getAttribute('tabindex'),state:e.getAttribute('data-state'),id:e.id,display:s.display,visibility:s.visibility,opacity:s.opacity,pointerEvents:s.pointerEvents,box:{x:r.x,y:r.y,width:r.width,height:r.height}})}return rows;
  }))()`)));
} else if (mode === "metrics") {
  console.log(JSON.stringify(await command("Page.getLayoutMetrics")));
} else if (mode === "ui" || mode === "ui-all") {
  console.log(JSON.stringify(await evaluate(`(() => {
    const visible = node => { const r=node.getBoundingClientRect(); return r.width>0 && r.height>0 && r.bottom>0 && r.right>0 && r.top<innerHeight && r.left<innerWidth && getComputedStyle(node).visibility!=='hidden'; };
    const scope = [...document.querySelectorAll('[role="dialog"]')].filter(visible).at(-1) ?? document;
    const box = node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
    return {
      location: location.origin+location.pathname+location.hash,
      controls:[...scope.querySelectorAll('button,a,[role="button"],input,select,[role="slider"],[role="menuitem"],[role="tab"],[role="switch"],[role="combobox"],[role="checkbox"],[contenteditable="true"]')].filter(node => ${mode === "ui-all"} || visible(node)).map(node=>({
        tag:node.tagName,role:node.getAttribute('role'),id:node.id,aria:node.getAttribute('aria-label'),type:node.getAttribute('type'),
        text:node.matches('input,[contenteditable="true"]')?null:(node.innerText??'').trim().slice(0,150),
        placeholder:node.getAttribute('placeholder'),testId:node.getAttribute('data-testid'),
        checked:node.getAttribute('aria-checked')??node.checked,disabled:node.disabled,box:box(node),
        range:node.getAttribute('role')==='slider'?{value:node.getAttribute('aria-valuenow'),min:node.getAttribute('aria-valuemin'),max:node.getAttribute('aria-valuemax'),text:node.getAttribute('aria-valuetext')}:undefined,
        value:['custom-connector-name','custom-connector-description'].includes(node.id)?node.value:undefined,
        options:node.tagName==='SELECT'?[...node.options].map(o=>({text:o.text,selected:o.selected})):undefined
      })),
      panels:[...document.querySelectorAll('[role="dialog"],[role="menu"],[role="alert"],[data-sonner-toast],[aria-live]')].filter(visible).map(node=>(node.innerText??'').slice(0,6500))
    };
  })()`)));
} else if (mode === "navigate") {
  const destination = new URL(process.argv[5]);
  if (process.env.CXP_CDP_SURFACE !== "web" || destination.origin !== "https://chatgpt.com") throw new Error("navigate only supports the selected ChatGPT Web surface");
  await command("Page.navigate", { url: destination.href });
  console.log(JSON.stringify({ navigated: destination.origin + destination.pathname + destination.hash }));
} else if (mode === "activate" || mode === "focus" || mode === "select-next" || mode === 'arrow-right') {
  const selector = process.argv[5];
  const doc = await command("DOM.getDocument");
  const matches = await command("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector });
  if (matches.nodeIds.length !== 1) throw new Error(`Expected one control, found ${matches.nodeIds.length}`);
  const nodeId = matches.nodeIds[0];
  await command("DOM.scrollIntoViewIfNeeded", { nodeId });
  await command("DOM.focus", { nodeId });
  if (mode !== "focus") {
    const key = mode === "select-next" ? "ArrowDown" : mode === 'arrow-right' ? 'ArrowRight' : "Enter";
    const keyCode = mode === "select-next" ? 40 : mode === 'arrow-right' ? 39 : 13;
    await command("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: keyCode });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: keyCode });
  }
  console.log(JSON.stringify({ activated: true }));
} else if (mode === "input") {
  if (process.argv[6]) {
    const expected = process.argv[6];
    const check=`globalThis.__cxpActiveThreadId===${JSON.stringify(expected)}&&[...document.querySelectorAll('button')].some(b=>/ChatGPT Web.*Sol.*Full/s.test(b.innerText??''))`;
    let matches=false; const deadline=Date.now()+10000;
    do {matches=await evaluate(check);if(matches)break;await new Promise(r=>setTimeout(r,200));}while(Date.now()<deadline);
    if (!matches) throw new Error('Expected Full test thread is not active; draft was not inserted');
  }
  const focus = await evaluate(`(() => { const e=document.activeElement; return {editable:Boolean(e?.isContentEditable||e?.matches('input,textarea')),type:e?.getAttribute('type')}; })()`);
  if (!focus.editable || focus.type === "password") throw new Error("Focus is not a non-password editor");
  await command("Input.insertText", { text: process.argv[5] ?? "" });
  console.log(JSON.stringify({ inserted: true }));
} else if (mode === "escape") {
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
} else if (mode === 'crash-web-fixture') {
  if (process.env.CXP_CDP_SURFACE !== 'web' || new URL(target.url).pathname !== process.argv[5]) throw new Error('Crash requires the exact observed owned Web fixture path');
  const owned = await evaluate(`(()=>{
    const text=[...document.querySelectorAll('[data-turn="user"]')].at(-1)?.textContent??'';
    const start=text.indexOf('<codex_context_json>'),end=text.indexOf('</codex_context_json>');
    if(start<0||end<0)return false;
    const records=JSON.parse(text.slice(start+20,end).trim()).task_context.records;
    const last=records.filter(r=>r.role==='user').at(-1);
    return last?.content?.some(p=>p.text?.includes('K5-renderer-crash'))&&!!document.querySelector('[data-testid="stop-button"]');
  })()`);
  if (!owned) throw new Error('The latest fixture must explicitly be K5-renderer-crash and still generating');
  let timer;
  const gone = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Fixture renderer loss was not observed')), 5000);
    socket.addEventListener('close', resolve, { once: true });
  });
  socket.send(JSON.stringify({ id: nextId++, method: 'Page.crash' }));
  try { await gone; console.log(JSON.stringify({ ownedFixtureRendererGone: true })); }
  finally { clearTimeout(timer); }
} else if (mode === 'close-web') {
  if (process.env.CXP_CDP_SURFACE !== 'web' || new URL(target.url).pathname !== process.argv[5]) throw new Error('Close requires the exact observed owned Web conversation path');
  let timer;
  const closed = new Promise((resolve,reject) => {
    timer=setTimeout(()=>reject(new Error('Owned browser close was not acknowledged')),5000);
    socket.addEventListener('close',resolve,{once:true});
  });
  socket.send(JSON.stringify({id:nextId++,method:'Page.close'}));
  try { await closed; console.log(JSON.stringify({ownedWebClosed:true})); } finally { clearTimeout(timer); }
} else if (mode === 'quit-app') {
  if (process.env.CXP_CDP_SURFACE === 'web' || !target.url.startsWith('app://-/')) throw Error('Requires the native Codex++ window');
  if (!await evaluate(`[...globalThis.__cxpRunningTurns??[]].length===0`)) throw Error('Refusing to quit an active app');
  // CDP key events do not trigger this build's native accelerator. Use the
  // already-open, observed File menu and its unique Quit row instead.
  const point=await evaluate(`(()=>{const rows=[...document.querySelectorAll('[role="menu"][data-state="open"] [role="menuitem"]')].filter(e=>/uygulamasından çık/.test(e.innerText));if(rows.length!==1)throw Error('Open the observed File menu first');const r=rows[0].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  socket.send(JSON.stringify({id:nextId++,method:'Input.dispatchMouseEvent',params:{type:'mouseReleased',...point,button:'left',clickCount:1}}));
  console.log(JSON.stringify({quitRequested:true,processExitVerified:false}));
} else if (mode === "quit") {
  const closed = new Promise(resolve => socket.addEventListener("close", resolve, { once: true }));
  socket.send(JSON.stringify({ id: nextId++, method: "Browser.close" }));
  await closed;
  console.log(JSON.stringify({ browserClosed: true }));
} else if (mode === "globals") {
  const result = await evaluate(`(() => {
    const view = window.__codexpp?.accountsSync?.() ?? null;
    const accounts = view?.accounts ?? [];
    const known = accounts.filter((account) => Number.isFinite(account.usedPercent));
    const totalWeight = known.reduce((sum, account) => sum + (account.planWeight > 0 ? account.planWeight : 1), 0);
    const weightedRemaining = totalWeight
      ? known.reduce((sum, account) => sum + (account.planWeight > 0 ? account.planWeight : 1) * (100 - account.usedPercent), 0) / totalWeight
      : null;
    return {
      globals: {
        codexpp: typeof window.__codexpp,
        frozen: Object.isFrozen(window.__codexpp),
        learnThread: typeof globalThis.__cxpLearnThread,
        autoRoute: typeof globalThis.__cxpAutoRoute,
        markActiveIneligible: typeof globalThis.__cxpMarkActiveIneligible,
        activate: typeof globalThis.__cxpActivate,
        restore: typeof globalThis.__cxpRestore,
        restorePromisePresent: globalThis.__cxpRestorePromise instanceof Promise,
        clientHosts: Object.keys(globalThis.__cxpClients ?? {}).sort(),
      },
      pool: {
        count: accounts.length,
        activePresent: Boolean(view?.activeAccountId),
        defaultPresent: Boolean(view?.defaultAccountId),
        activeIsDefault: Boolean(
          view?.activeAccountId && view.activeAccountId === view.defaultAccountId
        ),
        weightedRemaining,
        roundedWeightedRemaining: weightedRemaining == null ? null : Math.round(weightedRemaining),
        accounts: accounts.map((account) => ({
          active: account.id === view.activeAccountId,
          planType: account.planType,
          planWeight: account.planWeight,
          usedPercent: account.usedPercent,
          windowMins: account.windowMins,
        })),
      },
    };
  })()`);
  console.log(JSON.stringify(result));
} else if (mode === "buttons") {
  const result = await evaluate(`(() => [...document.querySelectorAll('button')]
    .map((button, index) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        index,
        text: (button.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 100),
        ariaLabel: button.getAttribute('aria-label'),
        title: button.getAttribute('title'),
        dataState: button.getAttribute('data-state'),
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    })
    .filter((button) => button.visible))()`);
  console.log(JSON.stringify(result));
} else if (mode === "click" || mode === 'click-selector') {
  let x = Number(process.argv[5]);
  let y = Number(process.argv[6]);
  if (mode === 'click-selector') {
    const box = await evaluate(`(()=>{const rows=[...document.querySelectorAll(${JSON.stringify(process.argv[5])})].filter(e=>e.getBoundingClientRect().width);if(rows.length!==1)throw new Error('Expected one visible click target');const r=rows[0].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    x = box.x; y = box.y;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("click mode requires x and y");
  await command("Page.bringToFront");
  await evaluate(`(() => { const rows=[]; const handler=e=>rows.push({type:e.type,x:e.clientX,y:e.clientY,trusted:e.isTrusted,tag:e.target?.tagName,aria:e.target?.closest('button')?.getAttribute('aria-label')}); for(const t of ['pointerdown','pointerup','click'])document.addEventListener(t,handler,true); window.__cxpDiagnosticPointer={rows,handler}; })()`);
  console.log(JSON.stringify(await evaluate(`(() => { const e=document.elementFromPoint(${x},${y})?.closest('button,[role="menuitem"],input,[role="checkbox"],[role="switch"],[role="combobox"]'); return {hit:e?{tag:e.tagName,aria:e.getAttribute('aria-label'),text:(e.innerText??'').slice(0,80)}:null,focused:document.hasFocus()}; })()`)));
  const metrics = await command("Page.getLayoutMetrics");
  const zoom = metrics.cssVisualViewport?.zoom ?? metrics.visualViewport?.zoom ?? 1;
  x *= zoom;
  y *= zoom;
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  console.log(JSON.stringify(await evaluate(`(() => { const probe=window.__cxpDiagnosticPointer; for(const t of ['pointerdown','pointerup','click'])document.removeEventListener(t,probe.handler,true); delete window.__cxpDiagnosticPointer; return {pointerEvents:probe.rows,ratio:devicePixelRatio,viewport:{width:innerWidth,height:innerHeight,scale:visualViewport?.scale}}; })()`)));
  await new Promise((resolve) => setTimeout(resolve, 700));
  const result = await evaluate(`(() => ({
    overlays: [...document.querySelectorAll('[role="menu"], [role="dialog"]')]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((node) => ({
        role: node.getAttribute('role'),
        text: (node.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 2000),
      })),
    path: location.pathname,
  }))()`);
  console.log(JSON.stringify(result));
} else if (mode === "snapshot") {
  const outputPath = process.argv[5];
  if (!outputPath) throw new Error("snapshot mode requires an output path");
  const result = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(outputPath, Buffer.from(result.data, "base64"));
  console.log(JSON.stringify({ outputPath, bytes: fs.statSync(outputPath).size }));
} else if (mode === "page") {
  const result = await evaluate(`(() => ({
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    bodyText: (document.body?.innerText ?? "").replace(/\\s+/g, " ").trim().slice(0, 2000),
    scripts: [...document.scripts].map(script => script.src || "inline").slice(-20),
    roots: [...document.body.children].map(node => ({ tag: node.tagName, id: node.id, className: String(node.className ?? "").slice(0, 120) })),
  }))()`);
  console.log(JSON.stringify(result));
} else if (mode === "models") {
  const result = await evaluate(`(() => [...document.querySelectorAll('*')]
    .map(node => {
      const rect = node.getBoundingClientRect();
      return {
        tag: node.tagName,
        role: node.getAttribute('role'),
        text: (node.innerText ?? '').trim().replace(/\\s+/g, ' ').slice(0, 120),
        ariaLabel: node.getAttribute('aria-label'),
        ariaHaspopup: node.getAttribute('aria-haspopup'),
        testId: node.getAttribute('data-testid'),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    })
    .filter(node => node.text.length < 160 && /Sol|Terra|Luna|Auto|5\\.\\d|Spark|Daybreak/i.test(node.text + ' ' + (node.ariaLabel ?? '')))
    .slice(-40))()`);
  console.log(JSON.stringify(result));
} else if (mode === "web-open") {
  console.log(JSON.stringify(await evaluate(`window.__codexpp?.webOpen?.({ show: true })`)));
} else if (mode === "web-status") {
  const result = await evaluate(`window.__codexpp?.webStatus?.() ?? null`);
  console.log(JSON.stringify(result));
} else {
  throw new Error(`unknown mode: ${mode}`);
}

socket.close();
