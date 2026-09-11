import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('late child notification replays a verified final without reopening browser or token; new instructions do not', async () => {
  const broker=require('../hub/turn-broker.cjs'), gateway=require('../hub/gateway.cjs');
  const file=require.resolve('../hub/web-session.cjs'), old=require.cache[file];
  let runs=0, token;
  require.cache[file]={id:file,filename:file,loaded:true,exports:{runTurn:({token:value})=>{token=value;runs++;return Promise.resolve({text:'verified parent final'});}}};
  const body={model:'chatgpt-web/sol-full',tools:[{name:'exec',type:'custom'}],input:[{type:'message',role:'user',content:'fixture'}],
    client_metadata:{'x-codex-turn-metadata':{thread_id:'late-child-parent',turn_id:'late-child-turn'}}};
  try {
    const {baseUrl}=await gateway.start();
    const send=async request=>(await fetch(`${baseUrl}/responses`,{method:'POST',body:JSON.stringify(request)})).text();
    const first=await send(body); assert.match(first,/verified parent final/);
    const final=first.split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))).find(x=>x.type==='response.completed').response.output;
    const child={type:'agent_message',id:'late-child-notice',author:'/root/fixture_child',recipient:'/root',content:[{type:'input_text',text:'child completed'}]};
    const late={...body,input:[...body.input,child]};
    const replay=await send(late);
    assert.match(replay,/verified parent final/);assert.doesNotMatch(replay,/response.failed/);assert.equal(runs,1);
    const annotated=await send({...body,input:[...body.input,...final,child]});
    assert.doesNotMatch(annotated,/response.failed/);assert.equal(runs,1);
    await assert.rejects(broker.requestTool(token,{callId:'after-final',input:'fixture'}),/revoked/);
    const changed=await send({...late,input:[...late.input,{type:'message',role:'user',content:'new steering'}]});
    assert.match(changed,/response.failed/);assert.equal(runs,1);
    const wrongRoute=await send({...body,input:[...body.input,{...child,id:'wrong-route',author:'/root',recipient:'/root/fixture_child'}]});
    assert.match(wrongRoute,/response.failed/);assert.equal(runs,1);
    const unknown=await send({...late,input:[...late.input,{type:'function_call_output',call_id:'unknown',output:'not a native receipt'}]});
    assert.match(unknown,/response.failed/);assert.equal(runs,1);
  } finally {await gateway.stop();if(old)require.cache[file]=old;else delete require.cache[file];}
});
test('preflight failure is an explicit error response, not an empty successful journal', async () => {
  const gateway = require('../hub/gateway.cjs');
  try {
    const { baseUrl } = await gateway.start();
    const response = await fetch(`${baseUrl}/responses`, { method: 'POST', body: JSON.stringify({
      model: 'chatgpt-web/sol-full', input: [], tools: [],
      client_metadata: { 'x-codex-turn-metadata': { thread_id: 'empty-registry', turn_id: 'empty-registry' } },
    }) });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'web_preflight_failed');
  } finally { await gateway.stop(); }
});
test('HTTP reconnect observes one accepted browser submission without changing its token', async () => {
  const broker = require('../hub/turn-broker.cjs');
  const sessionPath = require.resolve('../hub/web-session.cjs');
  const old = require.cache[sessionPath];
  let runs = 0, finish;
  require.cache[sessionPath] = { id: sessionPath, filename: sessionPath, loaded: true, exports: {
    runTurn() { runs++; return new Promise(resolve => { finish = resolve; }); },
  } };
  const gateway = require('../hub/gateway.cjs');
  try {
    const { baseUrl } = await gateway.start();
    const body = JSON.stringify({ model: 'chatgpt-web/sol-full', tools: [{ name: 'exec', type: 'custom' }],
      client_metadata: { 'x-codex-turn-metadata': { thread_id: 'reconnect-thread', turn_id: 'reconnect-turn' } },
      input: [{ type: 'message', role: 'user', content: 'controlled fixture' }] });
    const controller = new AbortController();
    const first = await fetch(`${baseUrl}/responses`, { method: 'POST', body, signal: controller.signal });
    assert.equal(first.status, 200);
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 30));
    const second = await fetch(`${baseUrl}/responses`, { method: 'POST', body });
    finish({ text: 'verified fixture final' });
    const wire = await second.text();
    assert.equal(runs, 1);
    assert.match(wire, /verified fixture final/);
    assert.doesNotMatch(wire, /response.failed/);
  } finally {
    broker.endAll('test shutdown'); await gateway.stop();
    if (old) require.cache[sessionPath] = old; else delete require.cache[sessionPath];
  }
});
