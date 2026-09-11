import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const contract = require('../hub/web-contract.cjs');
const native = require('../hub/native-tools.cjs');
const { ResponseStreamWriter } = require('../hub/responses-stream.cjs');

test('MCP request identity is explicit: reused JSON-RPC zero is not an invocation id', () => {
  const source=fs.readFileSync(new URL('../hub/mcp-server.cjs',import.meta.url),'utf8');
  const key=vm.runInNewContext(source.slice(source.indexOf('function hashCall('),source.indexOf('\nfunction exchangeBroker('))+'\nhashCall',{crypto:require('node:crypto')});
  const a={request_id:'invocation-one',cmd:'first'};
  assert.equal(key('token',0,'codex_exec',a),key('token',99,'codex_exec',{...a,cmd:'different'}),'same explicit id must reach the broker conflict check, not create another side effect');
  assert.notEqual(key('token',0,'codex_exec',a),key('token',0,'codex_exec',{...a,request_id:'invocation-two'}));
  assert.throws(()=>key('token',0,'codex_exec',{cmd:'legacy'}),/request_id|refresh/i);
});
const direct = contract.extractToolRegistry({ tools: [
  { name: 'exec_command', type: 'function', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } },
  { name: 'write_stdin', type: 'function' }, { name: 'apply_patch', type: 'custom' },
  { name: 'view_image', type: 'function' },
  { name: 'apps', type: 'namespace', tools: [{ name: 'read', type: 'function' }] },
] });

test('published MCP and broker IPC distinguish new calls, exact retries and conflicting retries', async () => {
  const broker=require('../hub/turn-broker.cjs'), socket=require('../hub/broker-socket.cjs');
  const target=process.platform==='win32' ? `\\\\.\\pipe\\cxp-invocation-${require('node:crypto').randomUUID()}` : require('node:path').join(require('node:os').tmpdir(),`cxp-${require('node:crypto').randomUUID()}.sock`);
  const key='mcp-invocations'; const turn=broker.begin(key,{threadId:key,turnId:'one',registry:direct});
  await socket.start(target);
  const handle=require('../hub/mcp-server.cjs').createMessageHandler({socketPath:target});
  const call=(request_id,id=0,cmd='fixture')=>handle({jsonrpc:'2.0',id,method:'tools/call',params:{name:'codex_exec',arguments:{turn_token:turn.token,request_id,cmd}}});
  try {
    for(const requestId of ['invocation-one','invocation-two']) {
      const pending=call(requestId);
      const {tool}=await broker.waitForTool(key,new Promise(()=>{}));
      assert.deepEqual(tool.arguments,{cmd:'fixture'});
      assert.equal(broker.deliverOutput(key,tool.callId,{content:[{type:'text',text:requestId}],isError:false}),true);
      assert.equal((await pending).result.content[0].text,requestId);
    }
    assert.equal(turn.calls.size,2,'two independent JSON-RPC id=0 requests must dispatch twice');
    assert.equal((await call('invocation-one',99)).result.content[0].text,'invocation-one');
    assert.match((await call('invocation-one',100,'different')).result.content[0].text,/different request/);
    assert.match((await call(undefined)).result.content[0].text,/request_id|refresh/);
    assert.equal(turn.calls.size,2); assert.equal(turn.queue.length,0);
  } finally { broker.end(key); await socket.stop(); }
});

test('one real MCP stdio channel delivers a child result while its parent invocation is pending', {timeout:3000}, async () => {
  const broker=require('../hub/turn-broker.cjs'),socket=require('../hub/broker-socket.cjs'),mcp=require('../hub/mcp-server.cjs');
  const {PassThrough}=require('node:stream');const input=new PassThrough(),output=new PassThrough();
  const target=process.platform==='win32'?`\\\\.\\pipe\\cxp-multiplex-${process.pid}`:require('node:path').join(require('node:os').tmpdir(),`cxp-multiplex-${process.pid}.sock`);
  const parent=broker.begin('stdio-parent',{registry:direct}),child=broker.begin('stdio-child',{registry:direct});
  const replies=[];let buffer='';output.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){replies.push(JSON.parse(buffer.slice(0,i)));buffer=buffer.slice(i+1);}});
  try {
    await socket.start(target);mcp.runStdio({argv:['node','mcp','--broker-socket',target],input,output});
    for(const [turn,id] of [[parent,1],[child,2]])input.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'codex_exec',arguments:{turn_token:turn.token,request_id:`invocation-${id}`,cmd:'fixture'}}})+'\n');
    const [p,c]=await Promise.all([broker.waitForTool(parent.key,new Promise(()=>{})),broker.waitForTool(child.key,new Promise(()=>{}))]);
    const firstReply=new Promise(resolve=>output.once('data',resolve));
    broker.deliverOutput(child.key,c.tool.callId,{content:[{type:'text',text:'child finished'}],isError:false});
    await firstReply;assert.deepEqual(replies.map(x=>x.id),[2]);
    assert.equal(broker.snapshot(parent.key).calls.dispatched,1);
    const secondReply=new Promise(resolve=>output.once('data',resolve));
    broker.deliverOutput(parent.key,p.tool.callId,{content:[{type:'text',text:'parent finished'}],isError:false});
    await secondReply;assert.deepEqual(replies.map(x=>x.id),[2,1]);
  } finally {input.end();broker.end(parent.key);broker.end(child.key);await socket.stop();}
});

test('Web-origin V2 message calls explicitly request plaintext delivery, unrelated tools stay untouched', () => {
  const chunks = []; const writer = new ResponseStreamWriter({write:x=>chunks.push(x)}, {model:'fixture'});
  writer.created();
  writer.toolCalls(['spawn_agent','send_message','followup_task','wait_agent'].map(name=>({callId:name,wireName:`collaboration.${name}`,name,namespace:'collaboration',kind:'function',arguments:{}})));
  for (const item of writer.output.slice(0,3)) assert.deepEqual(item.encrypted_function_args, []);
  assert.equal(writer.output[3].encrypted_function_args, undefined);
});

test('advertised V2 native calls use direct schemas and bounded wait polls without a guessed gateway', () => {
  const registry = contract.extractToolRegistry({tools:[{type:'namespace',name:'collaboration',tools:[
    {type:'function',name:'spawn_agent',parameters:{type:'object'}},
    {type:'function',name:'wait_agent',parameters:{type:'object',properties:{timeout_ms:{type:'number'}}}}
  ]}]});
  const invoke = (name,args) => native.resolveNativeRequest(registry,'codex_tool_call',{wire_name:`collaboration.${name}`,kind:'function',arguments:args});
  assert.equal(invoke('spawn_agent',{task_name:'fixture',message:'read-only'}).namespace,'collaboration');
  assert.equal(invoke('wait_agent',{timeout_ms:30000}).arguments.timeout_ms,30000);
  assert.throws(()=>invoke('wait_agent',{timeout_ms:60000}),/30000/);
  assert.throws(()=>invoke('wait_agent',{}),/30000/);
  assert.throws(()=>invoke('unknown',{}),/advertised/);
  const inventory=native.resolveNativeRequest(registry,'codex_tool_inventory',{}).result;
  assert.match(inventory.structuredContent.tools.find(t=>t.name==='wait_agent').description,/30000/);
});
test('tools[] namespaces and additional_tools namespaces have the same direct registry', () => {
  const tools = [{ type: 'namespace', name: 'functions', tools: [{ name: 'exec', type: 'custom' }] }];
  assert.deepEqual(contract.extractToolRegistry({ tools }), contract.extractToolRegistry({ input: [{ type: 'additional_tools', tools }] }));
  assert.ok(direct.some(x => x.wireName === 'apps.read'));
});
test('native command, stdin, patch, image and app calls keep advertised wire kind and payload', () => {
  const args = { turn_token: 'test-token', cmd: 'controlled-fixture' };
  assert.deepEqual(native.resolveNativeRequest(direct, 'codex_exec', args), { wireName: 'exec_command', name: 'exec_command', namespace: null, kind: 'function', arguments: { cmd: args.cmd } });
  assert.equal(native.resolveNativeRequest(direct, 'codex_apply_patch', { ...args, patch: 'PATCH' }).input, 'PATCH');
  assert.equal(native.resolveNativeRequest(direct, 'codex_write_stdin', { ...args, session_id: 12 }).arguments.session_id, 12);
  assert.equal(native.resolveNativeRequest(direct, 'codex_view_image', { ...args, path: '/fixture.png' }).arguments.path, '/fixture.png');
  const app = native.resolveNativeRequest(direct, 'codex_tool_call', { ...args, wire_name: 'apps.read', kind: 'function', arguments: {} });
  assert.equal(app.namespace, 'apps'); assert.equal(app.name, 'read');
  assert.throws(() => native.resolveNativeRequest(direct, 'codex_tool_call', { ...args, wire_name: 'apps.read', kind: 'freeform', input: '' }), /kind/);
});
test('missing tool never becomes guessed exec and inventory does not need exec', () => {
  assert.throws(() => native.resolveNativeRequest([], 'codex_apply_patch', { patch: 'PATCH' }), /advertised/);
  const page = native.resolveNativeRequest(direct, 'codex_tool_inventory', { cursor: 0, page_size: 2 }).result;
  assert.equal(page.structuredContent.tools.length, 2); assert.equal(page.structuredContent.nextCursor, 2);
  assert.equal(page.structuredContent.tools[0].surface, 'direct');
});
test('SSE emits function, custom patch and namespaced calls without rewriting to exec', () => {
  const chunks = [];
  const writer = new ResponseStreamWriter({ write: x => chunks.push(x) }, { model: 'fixture' });
  writer.created();
  writer.toolCalls([
    { callId: 'cmd', wireName: 'exec_command', kind: 'function', arguments: { cmd: 'fixture' } },
    { callId: 'patch', wireName: 'apply_patch', kind: 'freeform', input: 'PATCH' },
    { callId: 'app', wireName: 'apps.read', namespace: 'apps', name: 'read', kind: 'function', arguments: {} },
  ]); writer.completed();
  const rows = chunks.map(x => JSON.parse(x.split('data: ')[1]));
  const items = rows.filter(x => x.type === 'response.output_item.done').map(x => x.item);
  assert.deepEqual(items.map(x => [x.type, x.name, x.call_id]), [['function_call', 'exec_command', 'cmd'], ['custom_tool_call', 'apply_patch', 'patch'], ['function_call', 'read', 'app']]);
  assert.equal(items[2].namespace, 'apps');
  assert.equal(items[0].arguments, '{"cmd":"fixture"}');
  assert.ok(rows.some(x => x.type === 'response.function_call_arguments.done'));
});
test('native object result keeps session, error, image and unknown metadata', () => {
  const value = { output: 'running', session_id: 42, exit_code: null, custom: true };
  const normalized = contract.normalizeRichResult(value);
  assert.equal(normalized.session_id, 42); assert.equal(normalized.structuredContent.custom, true);
  assert.equal(normalized.content[0].text, 'running');
  const image = { content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }], isError: true, _meta: { trace: 'fixture' } };
  assert.deepEqual(contract.normalizeRichResult(image), image);
});
test('native input_image becomes a real MCP image without losing result metadata', () => {
  const { normalizeMcpResult } = require('../hub/mcp-server.cjs');
  const result = { content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'original' }],
    isError: false, structuredContent: { receipt: 'image-call' }, _meta: { retained: true } };
  const output = normalizeMcpResult(result);
  assert.equal(output.content[0].type, 'image');
  assert.equal(output.content[0].mimeType, 'image/png'); assert.equal(output.content[0].data, 'AA==');
  assert.equal(output.content[0]._meta['codex/imageDetail'], 'original');
  assert.deepEqual(output.structuredContent, result.structuredContent); assert.deepEqual(output._meta, result._meta);
  assert.equal(result.content[0].type, 'input_image');
  const link = normalizeMcpResult({ content: [{ type: 'input_image', image_url: 'https://example.test/fixture.png' }] });
  assert.equal(link.content[0].type, 'resource_link');
  assert.equal(link.content[0].uri, 'https://example.test/fixture.png');
  assert.throws(() => normalizeMcpResult({ content: [{ type: 'input_image', image_url: 'data:image/png;base64,broken!' }] }), /image|base64/i);
});

test('production gateway returns a direct broker call with its actual wire payload', async () => {
  const broker = require('../hub/turn-broker.cjs');
  const sessionPath = require.resolve('../hub/web-session.cjs');
  const old = require.cache[sessionPath];
  let token;
  require.cache[sessionPath] = { id: sessionPath, filename: sessionPath, loaded: true, exports: {
    runTurn({ token: current }) {
      token = current;
      const run = broker.requestTool(token, { callId: 'http-native-command', bridgeTool: 'codex_exec', bridgeArguments: { turn_token: token, request_id: 'http-native-command', cmd: 'fixture' } })
        .then(() => ({ text: 'done' }));
      return run;
    },
  } };
  const gateway = require('../hub/gateway.cjs');
  try {
    const { baseUrl } = await gateway.start();
    const body = { model: 'chatgpt-web/sol-full', client_metadata: { 'x-codex-turn-metadata': { thread_id: 'native-http-thread', turn_id: 'native-http-turn' } },
      tools: [{ type: 'function', name: 'exec_command' }], input: [{ type: 'message', role: 'user', content: 'fixture' }] };
    const response = await fetch(`${baseUrl}/responses`, { method: 'POST', body: JSON.stringify(body) });
    const wire = await response.text();
    assert.match(wire, /"type":"function_call"/);
    assert.match(wire, /"name":"exec_command"/);
    assert.match(wire, /"arguments":"\{\\"cmd\\":\\"fixture\\"\}"/);
  } finally {
    broker.endAll('test shutdown'); await gateway.stop();
    if (old) require.cache[sessionPath] = old; else delete require.cache[sessionPath];
  }
});
