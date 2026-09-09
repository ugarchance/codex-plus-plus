// Patches 094/095: navigation bridge publication, the header picker registration next to Share,
// and the pure row model the picker renders (accounts, pinned owner, external provider).
import assert from "node:assert/strict";
import vm from "node:vm";
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
import bridge from "../patch/patches/094-navigation-bridge.mjs";
import header from "../patch/patches/095-thread-account-header.mjs";

// --- 094: the bridge installer also publishes the callbacks on globalThis
const bridgeFixture = "function Bridge(t,c,u,n,o){return()=>{t.set(hT,{navigate:c,navigateToLocalConversation:u,pathname:n,prepareNavigation:o})}}globalThis.Bridge=Bridge;var hT='bridge';";
const bridgePatched = bridge.apply(bridgeFixture);
assert.throws(() => bridge.apply(bridgeFixture + bridgeFixture), /exactly once/);
const bridgeContext = { sets: [] }; bridgeContext.globalThis = bridgeContext;
vm.runInNewContext(bridgePatched, bridgeContext);
const navigate = () => "nav", toLocal = (id) => "local:" + id;
bridgeContext.Bridge({ set: (key, value) => bridgeContext.sets.push([key, value]) }, navigate, toLocal, "/x", () => {})();
assert.equal(bridgeContext.sets.length, 1, "the original store write still happens");
assert.equal(bridgeContext.__cxpNavigation.navigateToLocalConversation("t1"), "local:t1");
assert.equal(bridgeContext.__cxpNavigation.navigate(), "nav");

// --- 095: sibling HeaderAction before Share, keyed, with the same conversation/host props
const pageFixture = [
  "var Q,ss,ae,oi;",
  "Q={jsx:(t,p,k)=>({t,p,k}),jsxs:(t,p,k)=>({t,p,k}),Fragment:'Fragment'};",
  "ss={useState:v=>[typeof v==='function'?v():v,()=>{}],useRef:()=>({current:null}),useEffect:()=>{},useCallback:f=>f};",
  "ae={HeaderAction:'HeaderAction'};oi='Share';",
  "function $o(e){let t=[],{clientThreadId:n,conversationId:r,isArchivedPreview:i}=e;let h=`local`;let [A,j]=(0,ss.useState)(null);",
  "let se=r==null?null:(0,Q.jsx)(ae.HeaderAction,{actionId:`codex-conversation-share`,align:`end`,order:100,unifiedSlotPosition:`main`,children:(0,Q.jsx)(oi,{conversationId:r,hostId:h})});return se}",
  "globalThis.$o=$o;"
].join("");
const pagePatched = header.apply(pageFixture);
assert.throws(() => header.apply(pageFixture + pageFixture.replaceAll("$o", "$p")), /Expected one enclosing function/, "two registrations are rejected");
const view = { activeAccountId: "b", defaultAccountId: "a", accounts: [{ id: "a", label: "Alpha", planType: "pro", usedPercent: 20 }, { id: "b", label: "Beta", email: "b@x", planType: "plus", usedPercent: 55 }] };
const routing = { threadOwner: { "t-b": "b", "t-gone": "zzz" }, learnedIneligible: {} };
const page = { innerWidth: 1200 }; page.globalThis = page;
page.__codexpp = { accountsSync: () => view, routingView: () => routing, forgetThreadOwner: async () => routing };
vm.runInNewContext(pagePatched, page);
assert.equal(page.$o({ conversationId: null }), null, "no thread: nothing registered");
const tree = page.$o({ conversationId: "t-b" });
assert.equal(tree.t, "Fragment");
const [ours, theirs] = tree.p.children;
assert.equal(ours.t, "HeaderAction"); assert.equal(ours.p.actionId, "cxp-thread-account"); assert.equal(ours.p.order, 99);
assert.equal(ours.p.align, "end"); assert.equal(ours.p.unifiedSlotPosition, "main"); assert.equal(ours.k, "cxp-thread-account");
assert.equal(ours.p.children.t, page.__cxpThreadAccountPicker, "the picker component is the registered node");
same(ours.p.children.p, { conversationId: "t-b", hostId: "local" });
assert.equal(theirs.p.actionId, "codex-conversation-share"); assert.equal(theirs.k, "codex-conversation-share"); assert.equal(theirs.p.order, 100);

// --- rows model
const rows = page.__cxpThreadAccountRows;
let r = rows(view, routing, "t-new", null, null);
assert.equal(r.kind, "accounts"); assert.equal(r.pinned, false); assert.equal(r.selectedId, "a", "unpinned chats show the default account, not the engine's transient one"); assert.equal(r.label, "Alpha");
same(r.rows.map(x => [x.id, x.selected, x.left, x.plan]), [["a", true, 80, "pro"], ["b", false, 45, "plus"]]);
r = rows(view, routing, "t-b", null, null);
assert.equal(r.pinned, true); assert.equal(r.selectedId, "b"); assert.equal(r.label, "Beta");
r = rows(view, routing, "t-gone", null, null);
assert.equal(r.pinned, false, "an owner that is no longer connected does not count as a pin"); assert.equal(r.selectedId, "a");
r = rows(view, { ...routing, learnedIneligible: { b: "workspace" } }, "t-new", null, null);
assert.equal(r.rows[1].ineligible, true);
r = rows(view, routing, "t-b", { modelId: "cxp/opencode-go/x", connectionId: "c1" }, [{ id: "c1", label: "OpenCode Go" }]);
same([r.kind, r.label, r.model, r.rows.length, r.pinned], ["external", "OpenCode Go", "cxp/opencode-go/x", 0, false]);
r = rows(view, routing, "t-b", { modelId: "cxp/opencode-go/x", connectionId: "missing" }, null);
assert.equal(r.label, "opencode-go", "falls back to the provider segment of the model id");
assert.equal(rows(null, null, "t", null, null).label, "Account");

// --- picker smoke render with the stub React: trigger + dialog, one row per account, automatic row when pinned
const picked = page.__cxpThreadAccountPicker({ conversationId: "t-b", hostId: "local" });
assert.equal(picked.t, "Fragment");
const [trigger, dialog] = picked.p.children;
assert.equal(trigger.p["data-cxp"], "thread-account-trigger"); assert.match(trigger.p.title, /Pinned to Beta/);
assert.equal(dialog.t, "dialog"); assert.equal(dialog.p["data-cxp"], "thread-account-menu");
const rowKeys = dialog.p.children.filter(c => c && c.p && c.p["data-cxp"] === "thread-account-row").map(c => c.k);
same(rowKeys, ["a", "b", "automatic"]);
const unpinned = page.__cxpThreadAccountPicker({ conversationId: "t-new", hostId: "local" });
same(unpinned.p.children[1].p.children.filter(c => c && c.p && c.p["data-cxp"] === "thread-account-row").map(c => c.k), ["a", "b"]);
assert.match(unpinned.p.children[0].p.title, /default account: Alpha/);
console.log("Thread account header: bridge publication, sibling registration before Share, rows model and picker render passed");
