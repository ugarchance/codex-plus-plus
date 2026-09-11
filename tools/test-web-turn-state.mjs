import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import net from 'node:net';
const require = createRequire(import.meta.url);
const broker = require('../hub/turn-broker.cjs');
let count = 0;
function begin() { const key = `state-${++count}`; return broker.begin(key, { turnId: key }); }

test('dispatched timeout retires the browser owner and late receipts never revive its token', async () => {
  const turn=begin(); let cancelled=0;
  broker.attach(turn.key,new Promise(()=>{}),{cancel:()=>cancelled++});
  const pending=broker.requestTool(turn.token,{callId:'late-after-timeout',input:'fixture'},{timeoutMs:10});
  const failure=assert.rejects(pending,/uncertain|timed out/);
  await broker.waitForTool(turn.key,new Promise(()=>{})); await failure;
  assert.equal(cancelled,1); assert.equal(broker.get(turn.key),null);
  assert.equal(broker.deliverOutputs(turn.key,[{callId:'late-after-timeout',result:{exit_code:0}}])[0].status,'stale');
  await assert.rejects(broker.requestTool(turn.token,{callId:'late-after-timeout',input:'fixture'}),/revoked/);
});

test('oversized rich result returns a bounded explicit error and a retry cannot dispatch completed work again', async () => {
  const sockets = require('../hub/broker-socket.cjs'), mcp = require('../hub/mcp-server.cjs');
  const turn = begin(), call = { callId: 'large-result', wireName: 'exec', input: 'fixture' };
  const target = process.platform === 'win32' ? `\\\\.\\pipe\\codexpp-large-${process.pid}` : `/tmp/cxp-large-${process.pid}.sock`;
  try {
    await sockets.start(target);
    const first = mcp.callBroker(target, turn.token, call);
    const rejected = assert.rejects(first, /result.*1 MiB.*not.*retr/i);
    await broker.waitForTool(turn.key, new Promise(() => {}));
    broker.deliverOutput(turn.key, call.callId, { content: [{ type: 'image', mimeType: 'image/png', data: 'A'.repeat(1_048_576) }], isError: false });
    await rejected;
    await assert.rejects(mcp.callBroker(target, turn.token, call), /result.*1 MiB.*not.*retr/i);
    assert.equal(broker.snapshot(turn.key).queue, 0);
    assert.equal(broker.snapshot(turn.key).calls.resolved, 1);
  } finally { broker.end(turn.key); await sockets.stop(); }
});

test('native dispatch waits for the exact pre-tool answer observation and expired observations never enqueue', async () => {
  const turn = begin();
  let release;
  const observed = new Promise(resolve => { release = resolve; });
  try {
    assert.equal(typeof broker.setToolBoundaryObserver, 'function');
    broker.setToolBoundaryObserver(turn.token, () => observed);
    const tool = broker.requestTool(turn.token, { callId: 'observation-before-dispatch', input: 'fixture' }, { timeoutMs: 15 });
    const rejected = assert.rejects(tool, /before dispatch/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(broker.snapshot(turn.key).queue, 0);
    await rejected;
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(broker.snapshot(turn.key).queue, 0);
    assert.equal(broker.snapshot(turn.key).calls.expired, 1);
    const next = broker.requestTool(turn.token, { callId: 'observed-dispatch', input: 'fixture' });
    const boundary = await broker.waitForTool(turn.key, new Promise(() => {}));
    assert.equal(boundary.tool.callId, 'observed-dispatch');
    broker.deliverOutput(turn.key, boundary.tool.callId, 'fixture result');
    assert.equal(await next, 'fixture result');
  } finally { release(); broker.end(turn.key); }
});
test('browser completion cannot overtake a dispatched tool result', async () => {
  const turn = begin();
  try {
    const tool = broker.requestTool(turn.token, { callId: 'fence-call', input: 'fixture' });
    await broker.waitForTool(turn.key, new Promise(() => {}), { roundId: 'dispatch' });
    const early = broker.waitForTool(turn.key, Promise.resolve('premature final'), { roundId: 'finish' });
    await assert.rejects(early, /in-flight|pending|tool.*complete/i);
    broker.deliverOutputs(turn.key, [{ callId: 'fence-call', result: { content: [] } }]); await tool;
  } finally { broker.end(turn.key); }
});
test('completion fence is invalidated by new activity and closes tool admission after commit', async () => {
  const turn = begin();
  try {
    const revision = broker.beginCompletionFence(turn.token);
    const tool = broker.requestTool(turn.token, { callId: 'fence-late', input: 'fixture' });
    const rejected = assert.rejects(tool, /cancel/);
    assert.equal(broker.commitCompletionFence(turn.token, revision), false);
    broker.cancelTool(turn.token, 'fence-late', 'cancel fixture'); await rejected;
    const next = broker.beginCompletionFence(turn.token);
    assert.equal(broker.commitCompletionFence(turn.token, next), true);
    await assert.rejects(broker.requestTool(turn.token, { callId: 'after-final', input: '' }), /completion|final/);
  } finally { broker.end(turn.key); }
});
test('cancel before dispatch drains queue; after dispatch reports ambiguous and forbids replay', async () => {
  const turn = begin();
  try {
    for (const dispatched of [false, true]) {
      const callId = dispatched ? 'cancel-dispatched' : 'cancel-queued';
      const request = { callId, input: 'fixture' };
      const tool = broker.requestTool(turn.token, request);
      if (dispatched) await broker.waitForTool(turn.key, new Promise(() => {}), { roundId: callId });
      const rejected = assert.rejects(tool, dispatched ? /uncertain|ambiguous/ : /cancel/);
      broker.cancelTool(turn.token, callId, 'cancel fixture'); await rejected;
      assert.equal(broker.snapshot(turn.key).queue, 0);
      await assert.rejects(broker.requestTool(turn.token, request), /will not be retried/);
    }
  } finally { broker.end(turn.key); }
});
test('duplicate output must agree with accepted content', async () => {
  const turn = begin();
  try {
    const callId = 'output-conflict';
    const tool = broker.requestTool(turn.token, { callId, input: '' });
    await broker.waitForTool(turn.key, new Promise(() => {}));
    const output = { callId, result: { content: [{ type: 'text', text: 'one' }] } };
    assert.equal(broker.deliverOutputs(turn.key, [output])[0].status, 'accepted'); await tool;
    assert.equal(broker.deliverOutputs(turn.key, [output])[0].status, 'duplicate');
    assert.equal(broker.deliverOutputs(turn.key, [{ ...output, result: { content: [] } }])[0].status, 'conflict');
  } finally { broker.end(turn.key); }
});

test('native child context reaches the waiting Web tool without changing the native receipt', async () => {
  const turn=begin();
  const result={content:[{type:'text',text:'native wait result'}],structuredContent:{timed_out:true},isError:false};
  const updates=[{type:'agent_message',id:'child-complete',author:'/root/child',recipient:'/root',content:[{type:'input_text',text:'child receipt'}]}];
  try {
    const pending=broker.requestTool(turn.token,{callId:'context-wait',input:'fixture'});
    await broker.waitForTool(turn.key,new Promise(()=>{}));
    broker.deliverOutputs(turn.key,[{callId:'context-wait',result}],{contextUpdates:updates});
    const delivered=await pending;
    assert.deepEqual(delivered._meta?.codexpp_runtime_context,updates);
    assert.equal(delivered.content[0].text,result.content[0].text);
    assert.match(delivered.content[1].text,/child receipt/);
    assert.deepEqual(delivered.structuredContent,result.structuredContent);
    assert.equal(result._meta,undefined,'native receipt must not be mutated');
    assert.equal(broker.deliverOutputs(turn.key,[{callId:'context-wait',result}])[0].status,'duplicate');
  } finally {broker.end(turn.key);}
});

test('broker client disconnect cancels queued work before any native dispatch', async () => {
  const sockets = require('../hub/broker-socket.cjs');
  const turn = begin();
  const target = process.platform === 'win32' ? `\\\\.\\pipe\\codexpp-state-${process.pid}` : `/tmp/cxp-state-${process.pid}.sock`;
  let client;
  try {
    await sockets.start(target);
    client = net.createConnection(target);
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
    client.write(JSON.stringify({ operation: 'invoke', id: 'disconnect', token: turn.token, request: { callId: 'disconnect', wireName: 'exec', input: 'fixture' } }) + '\n');
    await new Promise(r => setTimeout(r, 20));
    assert.equal(broker.snapshot(turn.key).queue, 1);
    client.destroy(); await new Promise(r => setTimeout(r, 30));
    assert.equal(broker.snapshot(turn.key).queue, 0);
  } finally { client?.destroy(); broker.end(turn.key); await sockets.stop(); }
});
