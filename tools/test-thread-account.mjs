// Patch 093: the open thread id is published, turns and resumes follow the
// pinned account, and the menu pin helper activates then records the owner.
import assert from "node:assert/strict";
import vm from "node:vm";
import patch from "../patch/patches/093-thread-account.mjs";

const fixture =
  "function Layout(e){let t=[],{activeThreadId:n}=e;return n}" +
  "class Manager{constructor(){const c=new Client;this.requestClient=c;let r=this.settings.restricted;}get settings(){return{restricted:false}}}" +
  "class Client{async sendRequest(method,params){calls.push({method,threadId:params?.threadId,model:params?.model});return{ok:true}}}" +
  "globalThis.Layout=Layout;globalThis.Manager=Manager;globalThis.Client=Client;";
const patched = patch.apply(fixture);
assert.match(patched, /\{activeThreadId:n\}=e;globalThis\.__cxpPublishThread\?\.\(n\);/);
assert.match(patched, /globalThis\.__cxpInstallThreadAccounts\?\.\(this\.requestClient\)|__cxpInstallThreadAccounts\?\.\(/);
assert.throws(() => patch.apply(fixture + fixture), /exactly once/);

const calls = [], activations = [], learned = [];
let view = { activeAccountId: "a", accounts: [{ id: "a", usedPercent: 10 }, { id: "b", usedPercent: 20 }, { id: "c", usedPercent: 100 }, { id: "d", usedPercent: 5 }] };
let routing = { threadOwner: { "t-b": "b", "t-a": "a", "t-c": "c", "t-d": "d", "t-gone": "zzz" }, learnedIneligible: { d: "workspace" } };
const context = { calls, activations, learned, __cxpClients: {} };
context.globalThis = context;
context.__codexpp = {
  accountsSync: () => view,
  routingView: () => routing,
  learnThreadOwner: async (threadId, accountId) => { learned.push([threadId, accountId]); routing.threadOwner[threadId] = accountId; return routing; }
};
context.__cxpActivate = async (id) => { activations.push(id); view = { ...view, activeAccountId: id }; return view; };
vm.runInNewContext(patched, context);

// Layout render publishes the thread id, including null on the home route, and
// selecting a pinned chat moves the engine to its owner once.
assert.equal(context.Layout({ activeThreadId: "t-b" }), "t-b");
assert.equal(context.__cxpActiveThreadId, "t-b");
await new Promise(r => setImmediate(r));
assert.deepEqual(activations, ["b"], "selecting a chat pinned to b switches to b");
context.Layout({ activeThreadId: "t-b" });
await new Promise(r => setImmediate(r));
assert.deepEqual(activations, ["b"], "re-rendering the same chat does not switch again");
activations.length = 0;
view = { ...view, activeAccountId: "a" };
context.Layout({ activeThreadId: undefined });
assert.equal(context.__cxpActiveThreadId, null);
context.Layout({ activeThreadId: "new-conversation" });
assert.equal(context.__cxpActiveThreadId, null, "home draft id is not a thread");
context.Layout({ activeThreadId: "panel-new-conversation" });
assert.equal(context.__cxpActiveThreadId, null, "panel draft id is not a thread");

const manager = new context.Manager();
context.__cxpClients.local = manager;
const client = manager.requestClient;
assert.equal(client.__cxpThreadAccountsInstalled, true);
const run = (method, params) => client.sendRequest(method, params);

await run("turn/start", { threadId: "t-b" });
assert.deepEqual(activations, ["b"], "turn on a chat pinned to b switches to b first");
assert.equal(calls.at(-1).method, "turn/start");
await run("turn/start", { threadId: "t-b" });
assert.deepEqual(activations, ["b"], "already on the pinned account: no switch");
await run("thread/resume", { threadId: "t-a" });
assert.deepEqual(activations, ["b", "a"], "resume follows the pinned account too");
await run("turn/start", { threadId: "t-c" });
assert.deepEqual(activations, ["b", "a"], "an exhausted owner is not re-selected");
await run("turn/start", { threadId: "t-d" });
assert.deepEqual(activations, ["b", "a"], "a learned-ineligible owner is skipped");
await run("turn/start", { threadId: "t-gone" });
assert.deepEqual(activations, ["b", "a"], "an owner that is no longer connected is skipped");
await run("turn/start", { threadId: "t-new" });
assert.deepEqual(activations, ["b", "a"], "no owner: nothing happens");
await run("turn/start", { threadId: "t-b", model: "cxp/openrouter/x" });
assert.deepEqual(activations, ["b", "a"], "external provider threads are left alone");
await run("thread/start", { model: "gpt-5" });
assert.deepEqual(activations, ["b", "a"], "thread/start is not touched");
context.__cxpForkModel = "gpt-native";
calls.length = 0;
await run("thread/fork", { threadId: "t-b", model: "cxp/opencode/x" });
assert.equal(calls.at(-1).method, "thread/fork");
await run("thread/fork", { threadId: "t-b", model: "cxp/opencode/x" });
assert.equal(context.__cxpForkModel, null, "fork model override is consumed once");
const foreign = new context.Client(); context.__cxpInstallThreadAccounts(foreign);
await foreign.sendRequest("turn/start", { threadId: "t-b" });
assert.deepEqual(activations, ["b", "a"], "a non-local request client never switches accounts");
assert.equal(calls.filter(c => c.method === "turn/start").length, 1, "the foreign client request reached its original");
const forks = calls.filter(c => c.method === "thread/fork");
assert.deepEqual(forks.map(f => f.model), ["gpt-native", "cxp/opencode/x"], "first fork gets the native model, the second keeps its own");

// Menu pin: activate, then record the owner of the open chat.
const pinned = await context.__cxpPinThread("t-new", "b");
assert.equal(pinned.activeAccountId, "b");
assert.deepEqual(learned.at(-1), ["t-new", "b"]);
assert.equal(context.__cxpThreadOwner("t-new"), "b");
assert.equal(await context.__cxpPinThread(null, "a"), view, "no open chat: plain switch, nothing learned");
assert.equal(learned.length, 1);
console.log("Thread account: thread id publication, pinned-account follow on turn/resume, skip rules and menu pin passed");
