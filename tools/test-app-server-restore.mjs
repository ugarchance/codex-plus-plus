#!/usr/bin/env node

import assert from "node:assert/strict";
import vm from "node:vm";

import patch060 from "../patch/patches/060-app-server-client.mjs";

const fixture = [
  "class Example{",
  "constructor(host){if(host!==`local`)throw new Error(`does not match AppServerManager hostId ${host}`);this.hostId=host,void 0}",
  "async getAccount(options){return this.sendRequest(`account/read`,{refreshToken:!1},options)}",
  "async sendRequest(method,params){calls.push({type:`request`,method,accountId:params.chatgptAccountId});return {}}",
  "}",
].join("");
const patched = patch060.apply(fixture);

const calls = [];
const timerDelays = [];
const context = {
  calls,
  setTimeout(callback, delay) {
    timerDelays.push(delay);
    callback();
  },
};
context.globalThis = context;
context.__codexpp = {
  accountsSync() {
    return { defaultAccountId: "saved-account", activeAccountId: "saved-account" };
  },
  async activate(accountId, options) {
    calls.push({ type: options?.commit ? "commit" : "activate", accountId });
    return {
      ok: true,
      credentials: {
        accessToken: "test-access-token",
        chatgptAccountId: "test-chatgpt-account",
        chatgptPlanType: "pro",
      },
      view: { activeAccountId: accountId },
    };
  },
};

vm.runInNewContext(`${patched};globalThis.Example=Example`, context);
const client = new context.Example("local");
await client.getAccount({ source: "startup" });

assert.deepEqual(
  calls.map((call) => call.type),
  ["activate", "request", "commit", "request"],
  "startup account/read must wait until the saved account is re-applied to a fresh app-server",
);
assert.equal(calls[0].accountId, "saved-account");
assert.equal(calls[1].method, "account/login/start");
assert.equal(calls[3].method, "account/read");
assert.deepEqual(timerDelays, [], "the first restore attempt should run after a microtask, not a timer");

const unused = new context.Example("local");
assert.equal(context.__cxpClients.local, client, "a speculative constructor does not replace the responding manager");
await unused.sendRequest('account/read', {});
assert.equal(context.__cxpClients.local, unused, "actual request traffic selects the replacement manager");

for (const location of [{ pathname:'/index.html',search:'?initialRoute=%2Favatar-overlay' },{pathname:'/detached-window.html',search:'?initialRoute=%2Fdetached-window'}]) {
  const secondaryCalls=[],secondary={location,calls:secondaryCalls,setTimeout,__codexpp:context.__codexpp};secondary.globalThis=secondary;
  vm.runInNewContext(`${patched};globalThis.Example=Example`,secondary);
  const manager=new secondary.Example('local');await manager.getAccount({});
  assert.deepEqual(secondaryCalls.map(c=>c.method),['account/read'],'secondary windows must not reset the shared engine to the default account');
}

let authoritative=[client];
context.__cxpBindClients(client,()=>authoritative);
assert.equal(context.__cxpClients.local,client);
authoritative=[unused];
assert.equal(context.__cxpClients.local,unused,'native scope getter follows the authoritative manager without capturing an obsolete instance');

class Transport {
  constructor(hostId='local') { this.hostId=hostId; this.pending=new Map; }
  createRequest(id) {
    const promise=new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}));
    return { request:{id},promise };
  }
  onResult(id,value) { this.pending.get(id)?.resolve(value); this.pending.delete(id); }
  onError(id,error) { this.pending.get(id)?.reject(error); this.pending.delete(id); }
}
const oldTransport=new Transport(),newTransport=new Transport(),remoteTransport=new Transport('remote');
context.__cxpInstallResponseOwners(oldTransport);
context.__cxpInstallResponseOwners(newTransport);
const success=oldTransport.createRequest('success');
newTransport.onResult('success','completed');
assert.equal(await success.promise,'completed','scope replacement must not strand a successful response');
const failure=oldTransport.createRequest('failure');
newTransport.onError('failure',new Error('expected engine error'));
await assert.rejects(failure.promise,/expected engine error/);
const local=oldTransport.createRequest('same-id'),remote=remoteTransport.createRequest('same-id');
newTransport.onResult('same-id','local');
remoteTransport.onResult('same-id','remote');
assert.deepEqual(await Promise.all([local.promise,remote.promise]),['local','remote'],'request owners are scoped by host');
const cancelled=oldTransport.createRequest('cancelled');
oldTransport.pending.get('cancelled').reject(new Error('cancelled'));
await assert.rejects(cancelled.promise,/cancelled/);
const replacement=newTransport.createRequest('cancelled');
newTransport.onResult('cancelled','replacement');
assert.equal(await replacement.promise,'replacement','settled requests release ownership');

const navigationCalls=[];
context.setTimeout=()=>{};
context.__cxpActiveThreadId='pinned-chat';
context.__cxpNavigation={navigate(){}};
await context.__cxpActivate('saved-account',{transient:true});
context.__cxpInstallNavigation({navigate(){},navigateToLocalConversation:id=>navigationCalls.push(id)},'/');
await Promise.resolve();
assert.deepEqual(navigationCalls,['pinned-chat'],'an account scope reset preserves the open chat');
await context.__cxpActivate('saved-account',{transient:true});
context.__cxpInstallNavigation({navigate(){},navigateToLocalConversation:id=>navigationCalls.push(id)},'/settings');
await Promise.resolve();
assert.equal(navigationCalls.length,1,'a different intentional route must not be overwritten');

const queueFixture=fixture+';function execution(runtime){return{...runtime.queuedMessages,prepare:()=>{},isClientReady:()=>true}};const queueError=`Failed to initialize queued message execution`;';
const queueContext={};queueContext.globalThis=queueContext;
vm.runInNewContext(patch060.apply(queueFixture)+';globalThis.execution=execution',queueContext);
let ready=false;
const execution=queueContext.execution({queuedMessages:{get automaticExecutionEnabled(){return ready}}});
assert.equal(execution.automaticExecutionEnabled,false);
ready=true;
assert.equal(execution.automaticExecutionEnabled,true,'follow-up queue sees engine readiness after startup');
ready=false;
assert.equal(execution.automaticExecutionEnabled,false,'queue still respects loss of readiness');

let insideWatch=false,notify,stopped=false,deliveries=0;
const stop=context.__cxpDeferredSubscription(callback=>{
  notify=()=>{insideWatch=true;callback();insideWatch=false};
  notify();notify();
  return()=>{stopped=true};
},()=>{assert.equal(insideWatch,false,'queue execution must not add dependencies to the reactive watch');deliveries++});
assert.equal(deliveries,0);
await Promise.resolve();
assert.equal(deliveries,1,'multiple synchronous changes coalesce');
notify();stop();await Promise.resolve();
assert.equal(stopped,true);assert.equal(deliveries,1,'unsubscribed queues ignore pending notifications');

const subscriptionFixture=fixture+';function storage(scope){return{subscribeQueuedFollowUps:scope==null?void 0:$listener=>scope.watch(({get})=>{get(`queued`),$listener()})}};const errorText=`Global-state updates require an app scope`;';
const subscriptionContext={};subscriptionContext.globalThis=subscriptionContext;
vm.runInNewContext(patch060.apply(subscriptionFixture)+';globalThis.storage=storage',subscriptionContext);
let nativeWatch=false,nativeCalls=0;
subscriptionContext.storage({watch(callback){nativeWatch=true;callback({get(){}});nativeWatch=false;return()=>{}}}).subscribeQueuedFollowUps(()=>{assert.equal(nativeWatch,false);nativeCalls++});
assert.equal(nativeCalls,0);await Promise.resolve();assert.equal(nativeCalls,1,'actual patch defers the captured native watch callback');

let lockHeld=true,wakes=0;
const queue=()=>({tryAcquireStartTurn(){if(lockHeld)return false;lockHeld=true;return true},releaseStartTurn(){lockHeld=false}});
const prior={hostId:'local',runtime:{queuedMessages:queue()}},current={hostId:'local',runtime:{queuedMessages:queue()},turnCoordinator:{executionChanged(){wakes++}}};
context.__cxpClients={local:current};
context.__cxpInstallQueueWake(prior);context.__cxpInstallQueueWake(current);
assert.equal(current.runtime.queuedMessages.tryAcquireStartTurn('chat'),false);
assert.equal(lockHeld,true,'waiting never bypasses the native lock');
prior.runtime.queuedMessages.releaseStartTurn('chat');
assert.equal(wakes,0);await Promise.resolve();assert.equal(wakes,1,'a predecessor release wakes the current coordinator');
prior.runtime.queuedMessages.releaseStartTurn('chat');await Promise.resolve();assert.equal(wakes,1,'no busy polling without a recorded waiter');
assert.equal(current.runtime.queuedMessages.tryAcquireStartTurn('chat'),true);
current.runtime.queuedMessages.releaseStartTurn('chat');await Promise.resolve();assert.equal(wakes,1);

console.log("[PASS] startup restore re-applies the saved account to a fresh app-server");
