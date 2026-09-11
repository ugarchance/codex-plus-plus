#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import webModelPatch from "../patch/patches/120-web-models.mjs";

const require = createRequire(import.meta.url);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function unique(prefix) {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random()}`;
}

test("each logical user turn gets a fresh token and the old token is revoked", async () => {
  const broker = require("../hub/turn-broker.cjs");
  const key = unique("fresh-token");
  const first = broker.begin(key, { turnId: "turn-1", replace: true });
  const second = broker.begin(key, { turnId: "turn-2", replace: true });
  assert.notEqual(first.token, second.token);
  await assert.rejects(
    broker.requestTool(first.token, { callId: "old-call", wireName: "exec", input: "old" }),
    /no active|revoked|expired/i,
  );
  broker.end(key);
});

test("an expired queued tool cannot dispatch later", async () => {
  const broker = require("../hub/turn-broker.cjs");
  const key = unique("expired-queue");
  const turn = broker.begin(key, { turnId: "turn-expired", replace: true });
  await assert.rejects(
    broker.requestTool(turn.token, { callId: "expired-call", wireName: "exec", input: "danger" }, { timeoutMs: 20 }),
    /time|expired/i,
  );
  const next = await broker.waitForTool(key, Promise.resolve("browser-final"), { roundId: "round-after-timeout" });
  assert.deepEqual(next, { done: "browser-final" });
  broker.end(key);
});

test("end settles all tool and browser waiters", async () => {
  const broker = require("../hub/turn-broker.cjs");
  const toolKey = unique("end-tool");
  const toolTurn = broker.begin(toolKey, { turnId: "turn-tool", replace: true });
  const tool = broker.requestTool(toolTurn.token, { callId: unique("pending-call"), wireName: "exec", input: "pending" });
  broker.end(toolKey, "cancelled by test");
  await assert.rejects(tool, /cancelled by test/i);

  const waitKey = unique("end-waiter");
  broker.begin(waitKey, { turnId: "turn-wait", replace: true });
  const browser = broker.waitForTool(waitKey, new Promise(() => {}), { roundId: "round-waiting" });
  broker.end(waitKey, "cancelled by test");
  await assert.rejects(Promise.race([
    browser,
    new Promise((_, reject) => setTimeout(() => reject(new Error("browser waiter leaked")), 100)),
  ]), /cancelled by test/i);
});

test("three tool rounds preserve call ids and duplicate/stale states", async () => {
  const broker = require("../hub/turn-broker.cjs");
  const key = unique("three-rounds");
  const turn = broker.begin(key, { turnId: "turn-three", replace: true });
  for (let index = 1; index <= 3; index += 1) {
    const callId = `call-${index}`;
    const pending = broker.requestTool(turn.token, { callId, wireName: "exec", input: `source-${index}` });
    const next = await broker.waitForTool(key, new Promise(() => {}), { roundId: `round-${index}` });
    assert.equal(next.tool.callId, callId);
    const [accepted] = broker.deliverOutputs(key, [{ callId, result: { content: [{ type: "text", text: `result-${index}` }], isError: false } }]);
    assert.equal(accepted.status, "accepted");
    assert.deepEqual(await pending, { content: [{ type: "text", text: `result-${index}` }], isError: false });
    const [duplicate] = broker.deliverOutputs(key, [{ callId, result: { content: [{ type: "text", text: `result-${index}` }], isError: false } }]);
    assert.equal(duplicate.status, "duplicate");
  }
  const [unknown] = broker.deliverOutputs(key, [{ callId: "never-issued", result: { content: [] } }]);
  assert.equal(unknown.status, "unknown");
  broker.end(key);
});

test("terminal turn tombstones distinguish replay from historical tool evidence", () => {
  const broker = require("../hub/turn-broker.cjs");
  const endedKey = unique("ended-turn");
  broker.begin(endedKey, { turnId: "turn-ended", epoch: "0", replace: true });
  broker.end(endedKey, "completed");
  assert.deepEqual(broker.status(endedKey), {
    state: "closed",
    turnId: "turn-ended",
    epoch: "0",
    reason: "completed",
    at: broker.status(endedKey).at,
  });
  assert.equal(broker.status(unique("new-turn-with-history")).state, "unknown");
});

test("full prompt keeps developer, assistant, tool evidence, schema and images", () => {
  const contract = require("../hub/web-contract.cjs");
  const request = {
    model: "chatgpt-web/pro-harness",
    instructions: "system contract",
    text: { format: { type: "json_schema", name: "answer", schema: { type: "object" } } },
    input: [
      { type: "message", role: "developer", content: [{ type: "input_text", text: "developer rule" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "assistant decision" }] },
      { type: "custom_tool_call", call_id: "call-proof", name: "exec", input: "proof" },
      { type: "custom_tool_call_output", call_id: "call-proof", output: [{ type: "input_text", text: "tool evidence" }] },
      { type: "message", role: "user", content: [
        { type: "input_text", text: "use the image" },
        { type: "input_image", image_url: "data:image/png;base64,AA==", detail: "low" },
      ] },
    ],
  };
  const compiled = contract.compilePrompt(request, { token: "fresh-token", retained: false, harness: true });
  assert.match(compiled.text, /system contract/);
  assert.match(compiled.text, /developer rule/);
  assert.match(compiled.text, /assistant decision/);
  assert.match(compiled.text, /tool evidence/);
  assert.match(compiled.text, /json_schema/);
  assert.equal(compiled.images.length, 1);
  assert.match(compiled.text, /fresh-token/);
  assert.doesNotMatch(compiled.text, /secret\.txt|do not ask for permission|never ask/i);
});

test("retained context still carries the fresh transport token", () => {
  const contract = require("../hub/web-contract.cjs");
  const request = {
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "first" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
      { type: "message", role: "developer", content: [{ type: "input_text", text: "new developer rule" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "second" }] },
    ],
  };
  const compiled = contract.compilePrompt(request, { token: "token-for-second-turn", retained: true, harness: true });
  assert.match(compiled.text, /token-for-second-turn/);
  assert.match(compiled.text, /new developer rule/);
  assert.match(compiled.text, /second/);
});

test("retained identity ignores dynamic instructions but preserves their latest value", () => {
  const contract = require("../hub/web-contract.cjs");
  const metadata = { "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread-retained", turn_id: "turn-a" }) };
  const base = {
    model: "chatgpt-web/sol-full",
    client_metadata: metadata,
    input: [
      { type: "message", role: "developer", content: [{ type: "input_text", text: "durable developer rule" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "prior answer" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "follow-up" }] },
    ],
  };
  const first = { ...base, instructions: "dynamic budget 100" };
  const second = { ...base, instructions: "dynamic budget 99" };
  assert.equal(contract.conversationKeyOf(first, first.model, "account-a"), contract.conversationKeyOf(second, second.model, "account-a"));
  assert.notEqual(contract.conversationKeyOf(first, first.model, "account-a"), contract.conversationKeyOf(first, first.model, "account-b"));
  const retained = contract.compilePrompt(second, { token: "fresh", retained: true, harness: true, model: second.model });
  assert.match(retained.text, /dynamic budget 99/);
  assert.match(retained.text, /durable developer rule/);
});

test("turn identity does not collapse into prompt_cache_key", () => {
  const contract = require("../hub/web-contract.cjs");
  assert.throws(() => contract.parseTurnIdentity({ prompt_cache_key: "thread-only" }), /thread_id|turn_id/i);
  const identity = contract.parseTurnIdentity({
    prompt_cache_key: "cache-key",
    client_metadata: {
      "x-codex-turn-metadata": JSON.stringify({ thread_id: "thread-1", turn_id: "turn-2", context_window_id: "epoch-3" }),
    },
  });
  assert.deepEqual(
    { threadId: identity.threadId, turnId: identity.turnId, promptCacheKey: identity.promptCacheKey, epoch: identity.epoch, contextWindowId: identity.contextWindowId },
    { threadId: "thread-1", turnId: "turn-2", promptCacheKey: "cache-key", epoch: "0", contextWindowId: "epoch-3" },
  );
});

test("current engine additional_tools registry distinguishes freeform and function tools", () => {
  const contract = require("../hub/web-contract.cjs");
  const request = {
    tools: [],
    input: [{
      type: "additional_tools",
      role: "developer",
      tools: [{
        type: "namespace",
        name: "functions",
        tools: [
          { type: "custom", name: "exec", format: { type: "grammar" }, description: "gateway" },
          { type: "function", name: "wait", parameters: { type: "object" }, strict: true },
        ],
      }],
    }],
  };
  const inventory = contract.extractToolRegistry(request);
  assert.deepEqual(inventory.map(({ wireName, kind }) => ({ wireName, kind })), [
    { wireName: "functions.exec", kind: "freeform" },
    { wireName: "functions.wait", kind: "function" },
  ]);
});

test("all custom tool outputs preserve rich content and call ids", () => {
  const contract = require("../hub/web-contract.cjs");
  const outputs = contract.extractToolOutputs({ input: [
    { type: "custom_tool_call_output", call_id: "one", output: "plain" },
    { type: "custom_tool_call_output", call_id: "two", output: [{ type: "input_text", text: "two" }], is_error: true },
    { type: "function_call_output", call_id: "three", output: { content: [{ type: "image", data: "AA==", mimeType: "image/png" }], structuredContent: { ok: true }, isError: false } },
  ] });
  assert.deepEqual(outputs.map((item) => item.callId), ["one", "two", "three"]);
  assert.equal(outputs[1].result.isError, true);
  assert.deepEqual(outputs[2].result.structuredContent, { ok: true });
  assert.equal(outputs[2].result.content[0].type, "image");
});

test("unknown model and unavailable Pro are rejected before send", () => {
  const contract = require("../hub/web-contract.cjs");
  assert.throws(() => contract.requireWebModel("chatgpt-web/made-up", { solAvailable: true, proAvailable: true }), /not supported|unknown/i);
  assert.throws(() => contract.requireWebModel("chatgpt-web/pro-harness", { solAvailable: true, proAvailable: false }), /Pro.*not available|requires Pro/i);
});

test("stateful SSE emits parser-visible heartbeat and never completes a partial answer", () => {
  const { ResponseStreamWriter } = require("../hub/responses-stream.cjs");
  const chunks = [];
  const response = {
    headersSent: false,
    writeHead() { this.headersSent = true; },
    write(chunk) { chunks.push(String(chunk)); return true; },
    end() {},
  };
  const writer = new ResponseStreamWriter(response, { model: "chatgpt-web/pro", promptCacheKey: "cache" });
  writer.created();
  writer.heartbeat({ phase: "browser" });
  writer.textDelta("partial");
  writer.incomplete("deadline exceeded");
  const before = chunks.length;
  assert.equal(writer.textDelta("late"), false);
  assert.equal(chunks.length, before);
  const stream = chunks.join("");
  assert.match(stream, /event: response\.created/);
  assert.match(stream, /event: response\.heartbeat/);
  assert.match(stream, /event: response\.incomplete/);
  assert.doesNotMatch(stream, /event: response\.completed/);
});

test("MCP surface includes continuation, patch, image, inventory and direct native calls", () => {
  const mcp = require("../hub/mcp-server.cjs");
  assert.deepEqual(mcp.TOOLS.map((tool) => tool.name), [
    "codex_exec",
    "codex_write_stdin",
    "codex_apply_patch",
    "codex_view_image",
    "codex_tool_inventory",
    "codex_tool_call",
  ]);
});

test("effort selection refuses to clamp an unavailable Pro index", () => {
  const web = require("../hub/web-session.cjs");
  assert.throws(() => web.validateEffortRange(4, { min: 0, max: 3, now: 2 }), /not available|outside/i);
});

test("partial insert, DOM remount and navigation do not prove submission/completion", () => {
  const web = require("../hub/web-session.cjs");
  assert.equal(web.promptLanded("", "half", "half-and-more"), false);
  assert.equal(web.promptLanded("pill", "pillfull", "full"), true);
  assert.equal(web.promptLanded("", "fullfull", "full"), false);
  const submission = { url: "https://chatgpt.com/c/one", assistantCount: 1, lastAssistantId: "assistant-1" };
  assert.equal(web.responseBelongsToSubmission({ url: submission.url, count: 1, id: "assistant-1" }, submission), false);
  assert.equal(web.responseBelongsToSubmission({ url: submission.url, count: 1, id: "assistant-2" }, submission), true);
  assert.equal(web.responseBelongsToSubmission({ url: "https://chatgpt.com/", count: 2, id: "assistant-2" }, submission), false);
  assert.equal(web.verifiedFinalSnapshot({ text: "partial", terminal: false, streaming: true }), false);
  assert.equal(web.verifiedFinalSnapshot({ text: "done", terminal: true, streaming: false }), true);
});

test("composer paragraphs preserve literal newlines, not layout-generated blank lines", () => {
  const web = require("../hub/web-session.cjs");
  const text = value => ({ nodeType: 3, textContent: value });
  const element = (tagName, children = []) => ({ nodeType: 1, tagName, childNodes: children, classList: {contains: () => false} });
  const composer = element('DIV', [element('P',[text('pillfirst')]),element('P',[text('second')]),element('P',[]),element('P',[text('last')])]);
  assert.equal(web.readComposerText(composer), 'pillfirst\nsecond\n\nlast');
  assert.equal(web.promptLanded('pill',web.readComposerText(composer),'first\nsecond\n\nlast'), true);
});

test("renderer waits out the first null route and fails Web routing closed", async () => {
  const fixture = "let{request:r,promise:p}=this.createRequest(m,a,o,e);";
  const patched = webModelPatch.apply(fixture);
  const preamble = patched.slice(0, patched.indexOf(fixture.slice(0, 8)));
  let routeCalls = 0;
  globalThis.__codexpp = {
    gatewayRoute: () => (++routeCalls < 2
      ? { ready: false, baseUrl: null, generation: 0, models: [] }
      : { ready: true, baseUrl: "http://127.0.0.1:1234/backend-api/codex", generation: 1, models: [{ slug: "chatgpt-web/sol-full", label: "Web Full", description: "fixture" }] }),
  };
  try {
    new Function(preamble)();
    const listed = await globalThis.__cxpResult("model/list", Promise.resolve({ data: [{ model: "gpt-native", hidden: false }] }));
    assert.deepEqual(listed.data.map((row) => row.model), ["gpt-native", "chatgpt-web/sol-full"]);
    globalThis.__codexpp.gatewayRoute = () => ({ ready: false, baseUrl: null, generation: 0, models: [] });
    assert.throws(
      () => globalThis.__cxpParams("thread/start", { model: "chatgpt-web/sol-full" }, { hostId: "local" }),
      /gateway is not ready/i,
    );
    const native = { model: "gpt-native", config: { features: { code_mode: false } } };
    assert.equal(globalThis.__cxpParams("thread/start", native, { hostId: "local" }), native);
  } finally {
    delete globalThis.__codexpp;
    delete globalThis.__cxpGateway;
    delete globalThis.__cxpWebRowsV2;
    delete globalThis.__cxpParams;
    delete globalThis.__cxpResult;
  }
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(`  ${error?.stack ?? error}`);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} ChatGPT Web contract tests passed`);
if (failures) process.exitCode = 1;
