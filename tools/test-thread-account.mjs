// Patch 093: the open thread id is published; a pinned chat's turns run on its account through a
// transient engine switch; the engine returns to the default account after the turn or when the chat
// changes, never while a turn is running; pinning records the owner without touching the default.
import assert from "node:assert/strict";
import vm from "node:vm";
import patch from "../patch/patches/093-thread-account.mjs";

const fixture =
  "function Layout(e){let t=[],{activeThreadId:n}=e;return n}" +
  "class Manager{constructor(){const c=new Client;this.requestClient=c;let r=this.settings.restricted;}get settings(){return{restricted:false}}handleNotification(e){notified.push(e.method)}}" +
  "class Client{async sendRequest(method,params){calls.push({method,threadId:params?.threadId,model:params?.model});if(params?.fail)throw Error('boom');return{ok:true}}}" +
  "globalThis.Layout=Layout;globalThis.Manager=Manager;globalThis.Client=Client;";
const patched = patch.apply(fixture);
assert.match(patched, /\{activeThreadId:n\}=e;globalThis\.__cxpPublishThread\?\.\(n\);/);
assert.match(patched, /__cxpInstallThreadAccounts\?\.\(c,this\)/);
assert.throws(() => patch.apply(fixture + fixture.replaceAll("Layout", "Layout2").replaceAll("Manager", "Manager2").replaceAll("Client", "Client2")), /exactly once/);

const calls = [], activations = [], learned = [], notified = [];
let view = { activeAccountId: "a", defaultAccountId: "a", accounts: [{ id: "a", usedPercent: 10 }, { id: "b", usedPercent: 20 }, { id: "c", usedPercent: 100 }, { id: "d", usedPercent: 5 }] };
const routing = { threadOwner: { "t-b": "b", "t-a": "a", "t-c": "c", "t-d": "d", "t-gone": "zzz" }, learnedIneligible: { d: "workspace" } };
const context = { calls, activations, learned, notified, __cxpClients: {} };
context.globalThis = context;
context.__codexpp = {
  accountsSync: () => view,
  routingView: () => routing,
  learnThreadOwner: async (threadId, accountId) => { learned.push([threadId, accountId]); routing.threadOwner[threadId] = accountId; return routing; }
};
context.__cxpActivate = async (id, opts) => { activations.push([id, opts?.transient === true]); view = { ...view, activeAccountId: id, ...(opts?.transient ? {} : { defaultAccountId: id }) }; return view; };
vm.runInNewContext(patched, context);
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
const reset = () => { activations.length = 0; calls.length = 0; view = { ...view, activeAccountId: "a", defaultAccountId: "a" }; context.__cxpRunningTurns.clear(); };

// Publishing: real ids, null for drafts; selecting a pinned chat does not switch the engine.
assert.equal(context.Layout({ activeThreadId: "t-b" }), "t-b"); await settle();
assert.equal(context.__cxpActiveThreadId, "t-b"); assert.deepEqual(activations, [], "selecting a chat never switches by itself");
context.Layout({ activeThreadId: "new-conversation" }); assert.equal(context.__cxpActiveThreadId, null);
context.Layout({ activeThreadId: "panel-new-conversation" }); assert.equal(context.__cxpActiveThreadId, null);
context.Layout({ activeThreadId: undefined }); assert.equal(context.__cxpActiveThreadId, null);

const manager = new context.Manager(); context.__cxpClients.local = manager; const client = manager.requestClient;
assert.equal(client.__cxpThreadAccountsInstalled, true); assert.equal(manager.__cxpThreadAccountsInstalled, true);
const run = (method, params) => client.sendRequest(method, params);
const notify = (method, threadId) => manager.handleNotification({ method, params: { threadId } });

// A turn on a chat pinned to b: switch transiently, run, then come back to the default after completion.
await run("turn/start", { threadId: "t-b" }); await settle();
assert.deepEqual(activations, [["b", true]], "turn on a chat pinned to b switches the engine to b, transiently");
assert.equal(calls.at(-1).method, "turn/start"); assert.equal(view.defaultAccountId, "a", "the default account is untouched");
assert.equal(context.__cxpRunningTurns.has("t-b"), true);
notify("turn/completed", "t-b"); await settle();
assert.deepEqual(activations, [["b", true], ["a", true]], "completion restores the default account");
assert.equal(context.__cxpRunningTurns.size, 0); assert.deepEqual(notified.slice(-1), ["turn/completed"], "the original handler still runs");

// While a turn runs, nothing switches: a second chat's turn keeps the current engine account.
reset();
await run("turn/start", { threadId: "t-b" }); await settle();
await run("turn/start", { threadId: "t-new" }); await settle();
assert.deepEqual(activations, [["b", true]], "no switch while another turn is running");
context.Layout({ activeThreadId: "t-new" }); await settle();
assert.deepEqual(activations, [["b", true]], "changing chats does not restore the default mid-turn");
notify("turn/failed", "t-b"); await settle();
assert.deepEqual(activations, [["b", true]], "one turn still running: keep the account");
notify("turn/completed", "t-new"); await settle();
assert.deepEqual(activations, [["b", true], ["a", true]], "last turn done: back to the default");

// Selecting a chat while the engine is transiently elsewhere and idle restores the default.
reset(); view = { ...view, activeAccountId: "b" };
context.Layout({ activeThreadId: "t-a" }); await settle();
assert.deepEqual(activations, [["a", true]]);

// Fallbacks: exhausted, ineligible or missing owners use the default; resume/start/external/foreign untouched.
reset();
for (const threadId of ["t-c", "t-d", "t-gone", "t-new"]) { await run("turn/start", { threadId }); await settle(); notify("turn/completed", threadId); await settle(); }
assert.deepEqual(activations, [], "default already active: no switches");
await run("thread/resume", { threadId: "t-b" }); await run("thread/start", { model: "gpt-5" }); await run("turn/start", { threadId: "t-b", model: "cxp/openrouter/x" }); await settle();
assert.deepEqual(activations, [], "resume, start and external-provider turns never switch");
const foreign = new context.Client(); context.__cxpInstallThreadAccounts(foreign);
await foreign.sendRequest("turn/start", { threadId: "t-b" }); await settle();
assert.deepEqual(activations, [], "a non-local request client never switches");

// A failing turn/start request clears the running mark and restores the default.
reset();
await assert.rejects(run("turn/start", { threadId: "t-b", fail: true }), /boom/); await settle();
assert.deepEqual(activations, [["b", true], ["a", true]]); assert.equal(context.__cxpRunningTurns.size, 0);

// Fork model override is consumed once.
reset(); context.__cxpForkModel = "gpt-native";
await run("thread/fork", { threadId: "t-b", model: "cxp/opencode/x" }); await run("thread/fork", { threadId: "t-b", model: "cxp/opencode/x" });
assert.deepEqual(calls.filter(c => c.method === "thread/fork").map(f => f.model), ["gpt-native", "cxp/opencode/x"]);
assert.equal(context.__cxpForkModel, null);

// Pinning records the owner only.
reset(); learned.length = 0;
const pinned = await context.__cxpPinThread("t-new", "b"); await settle();
assert.equal(pinned.activeAccountId, "a"); assert.deepEqual(learned, [["t-new", "b"]]); assert.deepEqual(activations, [], "pinning does not switch");
assert.equal(context.__cxpThreadOwner("t-new"), "b");
assert.equal(await context.__cxpPinThread("t-new", "nope"), null); assert.equal(learned.length, 1, "unknown accounts are rejected");
assert.equal(await context.__cxpPinThread(null, "a"), null);
console.log("Thread account: publish, transient turn-time switch, default restore after turns and on chat change, running-turn guard, fallbacks and pin-only passed");
