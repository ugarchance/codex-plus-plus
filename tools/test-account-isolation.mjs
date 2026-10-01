import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import patch060 from '../patch/patches/060-app-server-client.mjs';
import { helpers as threadHelpers } from '../patch/patches/093-thread-account.mjs';
import { helpers as routingHelpers } from '../patch/patches/090-auto-routing-core.mjs';

const fixture = 'class Manager{constructor(){this.hostId=`local`;this.requestClient=transport;this.callbacks=[];if(this.hostId!==`local`)throw Error(`does not match AppServerManager hostId`)}async getAccount(o){return this.sendRequest(`account/read`,{refreshToken:!1},o)}sendRequest(...args){return this.requestClient.sendRequest(...args)}addNotificationCallback(methods,notify){this.callbacks.push({methods,notify})}}globalThis.Manager=Manager;';
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
async function setup(){
  let view={activeAccountId:'a',defaultAccountId:'a',accounts:[{id:'a'},{id:'b'}]},engine='a';
  const controls={missing:false,loginFailure:false},turns=[],phases=[];
  const routing={threadOwner:{tb:'b',tb2:'b',ta:'a'}};
  const context={setTimeout,transport:{async sendRequest(method,params){await Promise.resolve();if(method==='account/login/start'){if(controls.loginFailure&&params.chatgptAccountId==='b')throw Error('login failed');engine=params.chatgptAccountId;return{}}if(method==='turn/start')turns.push({thread:params.threadId,engine});return{}}},__codexpp:{accountsSync:()=>view,routingView:()=>routing,async activate(id,opts){phases.push({id,...opts});await Promise.resolve();if(opts.prepare){if(controls.missing&&id==='b')return{ok:false};return{ok:true,credentials:{accessToken:'fixture',chatgptAccountId:id}}}assert(opts.commit);view={...view,activeAccountId:id,...(!opts.transient?{defaultAccountId:id}:{})};return{ok:true,view}}}};
  context.globalThis=context;vm.runInNewContext(threadHelpers+'\n'+patch060.apply(fixture),context);
  const manager=new context.Manager();context.__cxpInstallThreadAccounts(manager.requestClient,manager);await context.__cxpRestorePromise;
  const start=thread=>manager.sendRequest('turn/start',{threadId:thread});
  const complete=async thread=>{for(const cb of manager.callbacks)cb.notify({method:'turn/completed',params:{threadId:thread}});await settle();};
  return{context,controls,turns,phases,start,complete,view:()=>view,engine:()=>engine};
}

for(const mode of ['missing','loginFailure']){
  const s=await setup();s.controls[mode]=true;
  await assert.rejects(s.start('tb'),/Could not sign in/);
  assert.deepEqual(s.turns,[]);assert.equal(s.view().activeAccountId,'a');assert.equal(s.view().defaultAccountId,'a');
  assert.equal(s.phases.filter(p=>p.id==='b'&&p.commit).length,0,'failed login never commits account state');
  assert.equal(s.context.__cxpRunningTurns.size,0);
  await s.start('ta');assert.deepEqual(s.turns,[{thread:'ta',engine:'a'}]);await s.complete('ta');
}
{
  const s=await setup(),results=await Promise.allSettled([s.start('tb'),s.start('ta')]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
  assert.match(String(results[1].reason),/Another account has a running chat/);
  assert.deepEqual(s.turns,[{thread:'tb',engine:'b'}]);assert.equal(s.view().defaultAccountId,'a');
  await assert.rejects(s.context.__cxpActivate('a'),/Another account has a running chat/);
  assert.equal(s.engine(),'b');assert.equal(s.view().activeAccountId,'b');
  await assert.rejects(s.start('tb'),/already has a running message/);
  await s.start('tb2');assert.deepEqual(s.turns,[{thread:'tb',engine:'b'},{thread:'tb2',engine:'b'}]);
  await s.complete('tb');assert.equal(s.engine(),'b');await s.complete('tb2');assert.equal(s.engine(),'a');
  assert.equal(s.view().defaultAccountId,'a');assert.equal(s.view().activeAccountId,'a');
  await s.start('ta');assert.equal(s.turns.at(-1).engine,'a');await s.complete('ta');
}
{
  const owners={existing:'b'},context={__codexpp:{accountsSync:()=>({defaultAccountId:'a',activeAccountId:'a'}),routingView:()=>({threadOwner:owners}),learnThreadOwner:(thread,id)=>{owners[thread]=id}}};
  context.globalThis=context;vm.runInNewContext(routingHelpers,context);
  await context.__cxpLearnThread('existing');await context.__cxpLearnThread('new');
  assert.deepEqual(owners,{existing:'b',new:'a'},'resume/unarchive notifications preserve an explicit pin');
}
console.log('Account isolation: failed credentials/login, atomic commit, simultaneous different-account rejection, same-account parallel turns, duplicate-turn guard, manual-switch guard, pin persistence and default restoration passed');
{
  const state={activeAccountId:'a',defaultAccountId:'a'},store={findAccount:id=>['a','b'].includes(id)?{id}:null,setActive:id=>{state.activeAccountId=id},setPreferred:id=>{state.defaultAccountId=id},publicView:()=>({...state})};
  const context={module:{exports:{}},require:name=>name==='node:path'?{}:name==='./store.cjs'?store:name==='./native.cjs'?{}:{credentialsFor:async id=>id==='b'?{chatgptAccountId:id}:null}};
  vm.runInNewContext(fs.readFileSync(new URL('../hub/accounts.cjs',import.meta.url),'utf8'),context);
  const api=context.module.exports;
  assert.equal((await api.activate('b',{prepare:true})).ok,true);assert.deepEqual(state,{activeAccountId:'a',defaultAccountId:'a'});
  assert.equal((await api.activate('missing',{prepare:true})).ok,false);assert.equal((await api.activate('missing',{commit:true})).ok,false);
  await api.activate('b',{commit:true,transient:true});assert.deepEqual(state,{activeAccountId:'b',defaultAccountId:'a'});
  await api.activate('b',{commit:true});assert.deepEqual(state,{activeAccountId:'b',defaultAccountId:'b'});
  console.log('Hub activation: prepare leaves state untouched; commit preserves transient default; missing accounts rejected');
}
