#!/usr/bin/env node

const host = process.argv[2] ?? "127.0.0.1";
const port = Number(process.argv[3] ?? 19333);

const targets = await fetch(`http://${host}:${port}/json`).then((r) => r.json());
const target = targets.find((item) => item.type === "page" && item.url === "app://-/index.html")
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
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});

const command = (method, params = {}) => {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${label}${detail !== undefined ? `  ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const route = await evaluate(`window.__codexpp?.gatewayRoute?.() ?? null`);
check("preload exposes generation-aware gateway readiness", route?.ready === true
  && typeof route?.baseUrl === "string"
  && route.baseUrl.startsWith("http://127.0.0.1:")
  && Number.isInteger(route?.generation), JSON.stringify(route));

const helpers = await evaluate(`JSON.stringify({
  rows: typeof globalThis.__cxpWebRowsV2,
  params: typeof globalThis.__cxpParams,
  result: typeof globalThis.__cxpResult
})`);
check("renderer helpers are installed", !JSON.parse(helpers ?? "{}").rows?.includes("undefined"), helpers);

const listed = await evaluate(`(async () => {
  const client = globalThis.__cxpClients?.local;
  if (!client) return "no app-server client";
  const res = await client.sendRequest("model/list", { includeHidden: true, cursor: null, limit: 100 });
  const rows = res?.data ?? [];
  return JSON.stringify({
    total: rows.length,
    web: rows.filter(r => String(r.model).startsWith("chatgpt-web/")).map(r => ({ model: r.model, displayName: r.displayName, hidden: r.hidden }))
  });
})()`);
const parsed = JSON.parse(listed ?? "{}");
check("model/list carries the ChatGPT Web row", (parsed.web?.length ?? 0) > 0, listed);

const injected = await evaluate(`JSON.stringify(globalThis.__cxpParams("thread/start", { cwd: "/tmp", model: "chatgpt-web/sol-full" }, { hostId: "local" }))`);
check("thread/start params carry the route", (injected ?? "").includes("openai_base_url"), injected);

const remote = await evaluate(`(()=>{try{globalThis.__cxpParams("thread/start", { cwd: "/tmp", model: "chatgpt-web/sol-full" }, { hostId: "remote" });return {rejected:false}}catch(e){return {rejected:true,message:e.message}}})()`);
check("remote Web selection is explicitly rejected", remote?.rejected === true && /local/i.test(remote.message), JSON.stringify(remote));

const untouched = await evaluate(`JSON.stringify(globalThis.__cxpParams("turn/start", { threadId: "x" }))`);
check("other methods are left alone", !(untouched ?? "").includes("openai_base_url"), untouched);

socket.close();
console.log(failures ? `\n${failures} check(s) failed` : `\nall checks passed`);
process.exit(failures ? 1 : 0);
