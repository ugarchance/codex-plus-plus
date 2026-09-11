import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const contract = require('../hub/web-contract.cjs');
const prefix = 'Another language model started to solve this problem and produced a summary of its thinking process.';

test('active compaction delivers canonical results once, intercepts future tools, and waits for physical settlement', async () => {
  const broker = require('../hub/turn-broker.cjs'), control = require('../hub/web-compaction.cjs');
  const turn = broker.begin('active-handoff-test', { threadId: 'active-handoff', turnId: 'work' });
  let release, finished = false;
  const settlement = new Promise(resolve=>{release=resolve;});
  const result = { session_id: 23, exit_code: 7, content: [{ type: 'text', text: 'actual output' }], isError: true };
  const pending = broker.requestTool(turn.token, { callId: 'active-one', wireName: 'exec', kind: 'freeform', input: 'never executes in this offline test' });
  await broker.waitForTool(turn.key, new Promise(()=>{}));
  const browser = pending.then(async delivered=>{
    assert.deepEqual(delivered,result);
    const denied=await broker.requestTool(turn.token,{callId:'future-one',wireName:'exec',kind:'freeform',input:'must not dispatch'});
    assert.equal(denied.isError,true);assert.match(denied.content[0].text,/compaction/i);
    return {text:'handoff-ready'};
  });
  browser.catch(()=>{});browser.settlement=settlement;broker.attach(turn.key,browser);
  const request={input:[{type:'function_call_output',call_id:'active-one',output:result}]};
  try {
    const wait=control.settleActiveSource(turn,request,broker);wait.then(()=>{finished=true;},()=>{});
    await new Promise(r=>setImmediate(r));
    assert.equal(finished,false);assert.equal(broker.snapshot(turn.key).queue,0);
    assert.equal(broker.snapshot(turn.key).calls.dispatched,undefined);
    release();assert.equal((await wait).text,'handoff-ready');
    assert.equal(broker.get(turn.key),null);
    await assert.rejects(broker.requestTool(turn.token,'stale'),/revoked|active/);
  } finally { release(); broker.endAll(); }
});

test('active compaction rejects missing or conflicting results before changing the source turn', async () => {
  const broker=require('../hub/turn-broker.cjs'),control=require('../hub/web-compaction.cjs');
  const turn=broker.begin('handoff-missing',{threadId:'handoff-missing',turnId:'work'});
  const pending=broker.requestTool(turn.token,{callId:'missing-one',wireName:'exec',kind:'freeform',input:'fixture'});pending.catch(()=>{});
  await broker.waitForTool(turn.key,new Promise(()=>{}));
  broker.attach(turn.key,new Promise(()=>{}));
  try {
    await assert.rejects(control.settleActiveSource(turn,{input:[]},broker),/required.*result|result.*required/);
    assert.equal(broker.snapshot(turn.key).calls.dispatched,1);
    assert.equal(turn.compactionResult,undefined);
  } finally {broker.endAll();}
});

test('gateway active handoff reaches the reserved checkpoint only after canonical results and physical drain', async () => {
  const broker=require('../hub/turn-broker.cjs'),gateway=require('../hub/gateway.cjs');
  const base={model:'chatgpt-web/sol-full',input:[{role:'user',content:'controlled fixture'}],client_metadata:{'x-codex-turn-metadata':{thread_id:'gateway-handoff',turn_id:'working'}}};
  const source=broker.begin('gateway-handoff',{threadId:'gateway-handoff',turnId:'working'});
  source.sourceRequest=base;source.chatKey=contract.conversationKeyOf(base,base.model,'browser-partition');
  const pending=broker.requestTool(source.token,{callId:'gateway-handoff-call',wireName:'exec',kind:'freeform',input:'fixture'});
  await broker.waitForTool(source.key,new Promise(()=>{}));
  let release;
  const physical=new Promise(resolve=>{release=resolve;});
  const browser=pending.then(()=>({text:'source finished'}));browser.settlement=physical;browser.catch(()=>{});broker.attach(source.key,browser);
  const file=require.resolve('../hub/web-session.cjs'),old=require.cache[file],real=require(file);
  let opened=0,committed=0;
  require.cache[file]={id:file,filename:file,loaded:true,exports:{observe:real.observe,commitContext(){committed++;},runTurn:async()=>{opened++;return{text:'receipt summary',checkpoint:true};}}};
  try {
    const {baseUrl}=await gateway.start();
    const request={...base,input:[...base.input,{type:'function_call',call_id:'gateway-handoff-call',name:'exec',arguments:'{}'},
      {type:'function_call_output',call_id:'gateway-handoff-call',output:'canonical result'}]};
    const response=fetch(`${baseUrl}/responses/compact`,{method:'POST',body:JSON.stringify(request)});
    await pending;assert.equal(opened,0);release();
    assert.equal((await response).status,200);assert.match(await(await response).text(),/receipt summary/);
    assert.equal(opened,1);assert.equal(committed,1);assert.equal(broker.get(source.key),null);
  } finally {release();broker.endAll();await gateway.stop();if(old)require.cache[file]=old;else delete require.cache[file];}
});
test('v1 replacement retains original user metadata/images within budget and uses the native summary prefix', () => {
  const users = [0,1,2,3].map(i => ({ role: 'user', id: `user-${i}`, metadata: { origin: 'user' }, content: [{ type: 'input_text', text: `message ${i}` }] }));
  users[3].content.push({ type: 'input_image', image_url: 'data:image/png;base64,ZmFrZQ==' });
  const result = contract.buildCompactionReplacement({ input: [...users, { type: 'message', role: 'user', content: '<goal_context>runtime</goal_context>' }] }, 'verified summary');
  assert.deepEqual(result.slice(0,4).map(x => x.id), users.map(x => x.id));
  assert.deepEqual(result[3].content, users[3].content);
  assert.equal(result.length, 5);
  assert.ok(result.at(-1).content[0].text.startsWith(prefix));
});
test('compaction replacement changes epoch and normalizes no hidden reasoning or lost message metadata', () => {
  const input = [{ role: 'user', id: 'u1', content: 'fixture' }];
  const metadata = { 'x-codex-turn-metadata': { thread_id: 't', turn_id: 'turn' } };
  const before = { input, client_metadata: metadata };
  const output = contract.buildCompactionReplacement(before, 'checkpoint');
  assert.notEqual(contract.parseTurnIdentity(before).epoch, contract.parseTurnIdentity({ ...before, input: output }).epoch);
  assert.equal(contract.normalizeInput(before).records[0].id, 'u1');
  assert.throws(() => contract.normalizeInput({ input: [{ type: 'compaction', encrypted_content: 'ocx1:!!!' }] }), /invalid|empty/i);
});
test('compaction with an active native turn fails before opening a second browser', async () => {
  const broker = require('../hub/turn-broker.cjs');
  broker.begin('active-fixture', { threadId: 'compact-thread', turnId: 'working' });
  const gateway = require('../hub/gateway.cjs');
  const file = require.resolve('../hub/web-session.cjs'), old = require.cache[file];
  let opened = 0;
  require.cache[file] = { id: file, filename: file, loaded: true, exports: { runTurn: async () => { opened++; return { text: 'wrong' }; } } };
  try {
    const { baseUrl } = await gateway.start();
    const response = await fetch(`${baseUrl}/responses/compact`, { method: 'POST', body: JSON.stringify({
      model: 'chatgpt-web/sol-full', input: [{ role: 'user', content: 'fixture' }],
      client_metadata: { 'x-codex-turn-metadata': { thread_id: 'compact-thread', turn_id: 'compact' } },
    }) });
    assert.equal(response.status, 409); assert.equal(opened, 0);
    assert.equal((await response.json()).error.code, 'active_compaction_unsupported');
  } finally { broker.endAll(); await gateway.stop(); if (old) require.cache[file] = old; else delete require.cache[file]; }
});
test('identical compaction retries preserve the first failure and never rerun browser submission', async () => {
  const gateway = require('../hub/gateway.cjs');
  const file = require.resolve('../hub/web-session.cjs'), old = require.cache[file];
  let opened = 0;
  require.cache[file] = { id: file, filename: file, loaded: true, exports: { runTurn: async () => { opened++; throw new Error('fixture initial submission failure'); } } };
  try {
    const { baseUrl } = await gateway.start();
    for (const version of ['v1', 'v2']) {
      const body = JSON.stringify({ model: 'chatgpt-web/sol-full', input: [{ role: 'user', content: 'checkpoint fixture' }, ...(version === 'v2' ? [{ type: 'compaction_trigger' }] : [])],
        client_metadata: { 'x-codex-turn-metadata': { thread_id: `retry-${version}`, turn_id: 'compact' } } });
      const outputs = [];
      for (let i = 0; i < 2; i++) {
        const response = await fetch(`${baseUrl}/responses${version === 'v1' ? '/compact' : ''}`, { method: 'POST', body });
        outputs.push(await response.text());
      }
      assert.equal(outputs[0], outputs[1], 'same compaction request must retain its exact original terminal outcome');
      assert.match(outputs[0], /fixture initial submission failure/);
    }
    assert.equal(opened, 2, 'one browser execution per compaction version, not one per HTTP retry');
  } finally { await gateway.stop(); if (old) require.cache[file] = old; else delete require.cache[file]; }
});

test('v1 and v2 compaction carry native cancellation identity without recompiling the checkpoint as ordinary work', async () => {
  const gateway = require('../hub/gateway.cjs');
  const file = require.resolve('../hub/web-session.cjs'), old = require.cache[file];
  const observed = [];
  require.cache[file] = { id: file, filename: file, loaded: true, exports: {
    runTurn: async options => { observed.push(options); return { text: 'checkpoint fixture' }; },
  } };
  try {
    const { baseUrl } = await gateway.start();
    for (const version of ['v1', 'v2']) {
      const request = { model: 'chatgpt-web/sol-full', input: [{ role: 'user', content: 'Do not resume this fixture task' }, ...(version === 'v2' ? [{ type: 'compaction_trigger' }] : [])],
        client_metadata: { 'x-codex-turn-metadata': { thread_id: `cancel-${version}`, turn_id: 'compact' } } };
      await (await fetch(`${baseUrl}/responses${version === 'v1' ? '/compact' : ''}`, { method: 'POST', body: JSON.stringify(request) })).text();
      const options = observed.at(-1);
      assert.deepEqual(options.identity, contract.parseTurnIdentity(request));
      assert.equal(options.request, undefined, 'an identity must not cause the precompiled compaction prompt to become an ordinary task');
      assert.match(options.prompt, /checkpoint/i);
      assert.match(options.compaction.instruction, /Do not run tools or continue the task/);
    }
  } finally { await gateway.stop(); if (old) require.cache[file] = old; else delete require.cache[file]; }
});

test('checkpoint capability is one-shot, bound to its handoff and cannot execute native work', async () => {
  const control = require('../hub/web-compaction.cjs');
  const broker = require('../hub/turn-broker.cjs');
  const tx = control.begin({ threadId: 'checkpoint', turnId: 'once' });
  const call = (wire_name, args = {}) => broker.requestTool(tx.token, { callId: 'control-call', bridgeTool: 'codex_tool_call',
    bridgeArguments: { turn_token: tx.token, wire_name, kind: 'function', arguments: args } });
  try {
    await assert.rejects(call('functions.exec_command', { cmd: 'must never dispatch' }), /no active|invalid|reserved/);
    await assert.rejects(call(control.WIRE_NAME, { handoff_id: 'wrong', summary: 'fixture' }), /handoff/);
    const result = await call(control.WIRE_NAME, { handoff_id: tx.handoffId, summary: ' exact checkpoint ' });
    assert.equal(result.structuredContent.submitted, true);
    assert.equal(await tx.promise, 'exact checkpoint');
    await assert.rejects(call(control.WIRE_NAME, { handoff_id: tx.handoffId, summary: 'again' }), /consumed|invalid/);
    assert.equal(control.size(), 0);
    assert.equal(broker.activeForThread('checkpoint').length, 0);
  } finally { control.endAll(); }
});

test('checkpoint timeout, cancellation and shutdown settle waiters without retaining capability', async () => {
  const control = require('../hub/web-compaction.cjs');
  const timed = control.begin({ threadId: 'checkpoint', turnId: 'timeout' }, { timeoutMs: 10 });
  await assert.rejects(timed.promise, /timed out/);
  const cancelled = control.begin({ threadId: 'checkpoint', turnId: 'cancel' });
  cancelled.abort(new Error('fixture cancel'));
  await assert.rejects(cancelled.promise, /fixture cancel/);
  const closed = control.begin({ threadId: 'checkpoint', turnId: 'close' });
  require('../hub/turn-broker.cjs').endAll();
  await assert.rejects(closed.promise, /shutdown|shutting down/);
  assert.equal(control.size(), 0);
});

test('retained checkpoint uses the bound connector, accepts only control delivery, and waits for physical Stop', async () => {
  const web = require('../hub/web-session.cjs');
  const source = fs.readFileSync(new URL('../hub/web-session.cjs', import.meta.url), 'utf8');
  const implementation = source.slice(source.indexOf('async function turn('), source.indexOf('\nfunction cancellationError('));
  const conversation = { key: 'task', url: 'https://chatgpt.com/c/retained', effortIndex: null, harness: true,
    historyMode: 'normal', plugin: { attached: true }, checkpoint: [{ type: 'message', role: 'user', content: [] }] };
  let stops = 0, outgoing, finished = false, release;
  const drain = new Promise(resolve => { release = resolve; });
  const run = vm.runInNewContext(implementation + '\nturn', {
    conversation, require: createRequire(new URL('../hub/web-session.cjs', import.meta.url)), process: { env: {} }, open() {}, chatHistoryMode: () => 'normal',
    AbortController, AbortSignal, window: { webContents: { getURL: () => conversation.url } }, composerPresent: async () => true,
    openChat: async () => { throw new Error('must retain the bound conversation'); }, step: async (_label, fn) => fn(),
    buildOutgoingPrompt: require('../hub/web-session.cjs').buildOutgoingPrompt,
    submissionSnapshot: async () => ({}), attachImages: async () => ({ cleanup() {} }), typePrompt: async text => { outgoing = text; },
    evaluate: async () => true, beginOwnedComposer: web.beginOwnedComposer, readComposerText: web.readComposerText,
    submitPrompt: async () => ({ url: conversation.url }), readAnswer: async () => 'ordinary text is not a handoff',
    stopGeneration: async () => { stops++; await drain; },
  });
  const result = run({ key: 'task', prompt: 'full history must not be resent', images: [], effortIndex: null, harness: false,
    compaction: { records: conversation.checkpoint, instruction: 'submit the reserved checkpoint', promise: Promise.resolve('verified checkpoint') } });
  result.then(() => { finished = true; }, () => {});
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stops, 1);
    assert.equal(finished, false);
    assert.equal(outgoing, 'submit the reserved checkpoint');
  } finally { release(); }
  assert.equal((await result).checkpoint, true);
  assert.equal((await result).text, 'verified checkpoint');
});

test('Full v1/v2 checkpoints traverse the published MCP call and broker IPC; HTTP retry reuses the receipt', async () => {
  const gateway = require('../hub/gateway.cjs');
  const control = require('../hub/web-compaction.cjs');
  const socket = require('../hub/broker-socket.cjs');
  const mcp = require('../hub/mcp-server.cjs');
  const target = process.platform === 'win32' ? `\\\\.\\pipe\\codexpp-checkpoint-${randomUUID()}` : path.join(os.tmpdir(), `cxpc-${randomUUID()}.sock`);
  const file = require.resolve('../hub/web-session.cjs'), old = require.cache[file];
  let browserRuns = 0;
  await socket.start(target);
  const handle = mcp.createMessageHandler({ socketPath: target });
  require.cache[file] = { id: file, filename: file, loaded: true, exports: { runTurn: async ({ compaction }) => {
    browserRuns++;
    const response = await handle({ jsonrpc: '2.0', id: browserRuns, method: 'tools/call', params: { name: 'codex_tool_call', arguments: {
      turn_token: compaction.token, request_id: compaction.handoffId, wire_name: control.WIRE_NAME, kind: 'function', arguments: { handoff_id: compaction.handoffId, summary: 'structured checkpoint fixture' },
    } } });
    assert.equal(response.result.isError, false);
    assert.equal(response.result.structuredContent.submitted, true);
    return { text: await compaction.promise, checkpoint: true };
  } } };
  try {
    const { baseUrl } = await gateway.start();
    for (const version of ['v1', 'v2']) {
      const request = { model: 'chatgpt-web/sol-full', input: [{ role: 'user', content: 'fixture' }, ...(version === 'v2' ? [{ type: 'compaction_trigger' }] : [])],
        client_metadata: { 'x-codex-turn-metadata': { thread_id: `mcp-${version}`, turn_id: 'checkpoint' } } };
      const outputs = [];
      for (let i = 0; i < 2; i++) {
        const response = await fetch(`${baseUrl}/responses${version === 'v1' ? '/compact' : ''}`, { method: 'POST', body: JSON.stringify(request) });
        assert.equal(response.status, 200);
        outputs.push(await response.text());
      }
      assert.equal(outputs[0], outputs[1]);
      assert.match(outputs[0], version === 'v1' ? /structured checkpoint fixture/ : /response.completed/);
      assert.doesNotMatch(outputs[0], /response.failed|response.incomplete/);
    }
    assert.equal(browserRuns, 2);
    assert.equal(control.size(), 0);
  } finally {
    control.endAll(); await gateway.stop(); await socket.stop();
    if (old) require.cache[file] = old; else delete require.cache[file];
  }
});
