import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const contract = require('../hub/web-contract.cjs');

test('engine compaction receives explicit estimated usage, never fabricated provider usage', () => {
  const request={input:[{type:'message',role:'user',content:'fixture evidence'}],model:'chatgpt-web/sol-full'};
  const result=contract.estimateUsage(request,[{type:'function_call',arguments:'{}'}]);
  assert.ok(result.usage.input_tokens>0);assert.ok(result.usage.output_tokens>0);
  assert.equal(result.usage.total_tokens,result.usage.input_tokens+result.usage.output_tokens);
  assert.equal(result.metadata.codexpp_usage.estimated,true);assert.equal(result.metadata.codexpp_usage.provider_usage,null);
  const chunks=[];const {ResponseStreamWriter}=require('../hub/responses-stream.cjs');
  const writer=new ResponseStreamWriter({write:s=>chunks.push(s)},{model:request.model});writer.created();writer.completed(result);
  const final=JSON.parse(chunks.at(-1).split('data: ')[1]).response;
  assert.deepEqual(final.usage,result.usage);assert.deepEqual(final.metadata,result.metadata);
});

test('plaintext V2 agent messages preserve routing and roles while opaque payloads fail before browser use', () => {
  const agent={type:'agent_message',id:'amsg_fixture',author:'/root',recipient:'/root/child',content:[{type:'input_text',text:'read-only task'}]};
  const request={input:[agent],client_metadata:{'x-codex-turn-metadata':{thread_id:'child',turn_id:'turn',parent_thread_id:'parent',agent_name:'/root/child',subagent_kind:'thread_spawn',request_kind:'turn'}}};
  const result=contract.normalizeInput(request).records[0];
  assert.equal(result.type,'agent_message'); assert.equal(result.role,'agentMessage');
  assert.equal(result.author,'/root'); assert.equal(result.recipient,'/root/child'); assert.equal(result.content[0].text,'read-only task');
  assert.throws(()=>contract.normalizeInput({...request,input:[{...agent,content:[{type:'encrypted_content',encrypted_content:'opaque'}]}]}),/encrypted|opaque/);
  assert.throws(()=>contract.normalizeInput({...request,input:[{...agent,recipient:'/root/other'}]}),/recipient|routing/);
  const next={...request,input:[agent,{...agent,id:'new-parent-instruction',content:[{type:'input_text',text:'new instruction'}]}]};
  assert.equal(contract.runtimeContextUpdates(request,next)[0].id,'new-parent-instruction');
  assert.deepEqual(contract.runtimeContextUpdates(next,next),[]);
  assert.throws(()=>contract.runtimeContextUpdates(request,{...request,input:[{...agent,content:[{type:'input_text',text:'changed'}]}]}),/existing identity/);
  assert.throws(()=>contract.runtimeContextUpdates(request,{...request,input:[agent,agent]}),/Duplicate/);
});

test('native checkpoint restoration preserves its source evidence, current instructions and epoch without decrypting reasoning', () => {
  const message = (role, text) => ({ type: 'message', role, content: [{ type: 'input_text', text }] });
  const user = message('user', 'fixture task');
  user.content.push({type:'input_image',image_url:'data:image/png;base64,AA==',detail:null});
  const checkpoint = { type: 'compaction', encrypted_content: 'opaque-fixture' };
  const source = [user, message('assistant', 'decision'), { type: 'function_call', call_id: 'one', name: 'exec', arguments: '{}' },
    { type: 'function_call_output', call_id: 'one', output: { session_id: 7, exit_code: 0, content: [{ type: 'image', mimeType: 'image/png', data: 'AA==' }] } }];
  const rows = [{ type: 'session_meta', payload: { id: 'thread' } }, ...source.map(payload => ({ type: 'response_item', payload })),
    { type: 'response_item', payload: { type: 'reasoning', encrypted_content: 'private-never-read', summary: [] } },
    { type: 'compacted', payload: { window_id: 'window-two', replacement_history: [user, checkpoint] } },
    { type: 'turn_context', payload: { turn_id: 'turn' } }];
  const wireUser=structuredClone(user);wireUser.content[1].detail='original';
  const request = { instructions: 'current system', input: [message('developer', 'current developer'), wireUser, checkpoint, message('user', 'continue')],
    client_metadata: { 'x-codex-turn-metadata': { thread_id: 'thread', turn_id: 'turn', context_window_id: 'window-two' } } };
  const original = JSON.stringify(request), epoch = contract.parseTurnIdentity(request).epoch;
  const recovered = require('../hub/web-history.cjs').restoreFromRollout(request, rows);
  const result = contract.normalizeInput(recovered);
  assert.equal(result.records.filter(x=>x.role==='user').length, 2, 'retained users must not be duplicated');
  assert.equal(result.records.find(x=>x.role==='developer').content[0].text, 'current developer');
  assert.ok(result.records.some(x=>x.role==='assistant' && x.content[0].text==='decision'));
  assert.equal(result.records.find(x=>x.type==='function_call_output').output.session_id, 7);
  assert.equal(result.images.length, 2);assert.equal(result.images[0].detail,'original');
  assert.doesNotMatch(JSON.stringify(result), /private-never-read|opaque-fixture/);
  assert.equal(contract.parseTurnIdentity(recovered).epoch, epoch);
  assert.equal(JSON.stringify(recovered), original, 'native wire/history must remain untouched');
  const tampered=structuredClone(request);tampered.input[1].content[1].image_url='data:image/png;base64,AQ==';
  assert.throws(()=>require('../hub/web-history.cjs').restoreFromRollout(tampered,rows),/boundary|history/i);
  for (const mutate of [r=>r[0].payload.id='wrong', r=>r.at(-1).payload.turn_id='wrong', r=>r.at(-2).payload.window_id='wrong', r=>r.at(-2).payload.replacement_history[0].content[0].text='conflict']) {
    const bad=structuredClone(rows);mutate(bad);
    assert.throws(()=>require('../hub/web-history.cjs').restoreFromRollout(request,bad), /identity|window|source|history|match/i);
  }
});
const msg = (role, text) => ({ type: 'message', role, content: [{ type: 'input_text', text }] });

test('image transport rejects unsupported MIME, noncanonical base64 and empty images before upload', () => {
  const web = require('../hub/web-session.cjs');
  const image = source => ({ source });
  assert.equal(typeof web.prepareImageAttachments, 'function');
  const valid = web.prepareImageAttachments([image('data:image/png;base64,AA==')]);
  assert.equal(valid[0].size, 1);
  assert.equal(valid[0].extension, 'png');
  for (const source of ['data:text/plain;base64,AA==', 'data:image/svg+xml;base64,AA==',
    'data:image/png;base64,A===', 'data:image/png;base64,AB==', 'data:image/png;base64,A', 'data:image/png;base64,']) {
    assert.throws(() => web.prepareImageAttachments([image(source)]), /image.*(media|base64|empty)/i);
  }
});

test('image transport bounds the whole batch in decimal bytes without silently dropping attachments', () => {
  const web = require('../hub/web-session.cjs');
  const image = size => ({ source: 'data:image/png;base64,' + Buffer.alloc(size).toString('base64') });
  assert.equal(typeof web.prepareImageAttachments, 'function');
  assert.throws(() => web.prepareImageAttachments(Array(11).fill(image(1))), /10.*image|image.*10/i);
  assert.throws(() => web.prepareImageAttachments([image(20_000_001)]), /20 MB/);
  const part = image(17_000_000);
  assert.throws(() => web.prepareImageAttachments([part, part, part]), /50 MB/);
});
test('retained suffix requires an exact canonical prefix, not the last assistant position', () => {
  const previous = [msg('developer', 'rule'), msg('user', 'one'), msg('assistant', 'decision')];
  const current = [...previous, msg('user', 'two')];
  assert.deepEqual(contract.canonicalSuffix(previous, current), [msg('user', 'two')]);
  assert.equal(contract.canonicalSuffix(previous, [msg('developer', 'changed'), ...current.slice(1)]), null);
  assert.equal(contract.canonicalSuffix(null, current), null);
});
test('desktop replay binds generated assistant metadata to its original logical turn', () => {
  const request = { client_metadata: { 'x-codex-turn-metadata': JSON.stringify({ thread_id: 'thread', turn_id: 'turn-one' }) },
    input: [{ ...msg('user', 'one'), internal_chat_message_metadata_passthrough: { turn_id: 'turn-one', content_item_kinds: ['user_message'] } }] };
  const output = [{ ...msg('assistant', 'decision'), id: 'answer', phase: 'final_answer', status: 'completed' }];
  const replay = { ...output[0], internal_chat_message_metadata_passthrough: { turn_id: 'turn-one', content_item_kinds: ['unknown'] } };
  delete replay.status;
  const checkpoint = contract.contextCheckpoint(request, output);
  const current = contract.normalizeInput({ ...request, input: [...request.input, replay, msg('user', 'two')] }).records;
  assert.deepEqual(contract.canonicalSuffix(checkpoint, current), contract.normalizeInput({ input: [msg('user', 'two')] }).records);
  current[1].internal_chat_message_metadata_passthrough.turn_id = 'wrong-turn';
  assert.equal(contract.canonicalSuffix(checkpoint, current), null);
  assert.equal(output[0].internal_chat_message_metadata_passthrough, undefined);
});
test('native replay completion status is transport-only; retained images are not attached twice', () => {
  const input = [{ ...msg('user', 'image task'), content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==' }] },
    { ...msg('assistant', 'decision'), id: 'answer', status: 'completed' }];
  const previous = contract.normalizeInput({ input }).records;
  const replay = structuredClone(input); delete replay[1].status; replay.push(msg('user', 'followup'));
  assert.notEqual(contract.canonicalSuffix(previous, contract.normalizeInput({ input: replay }).records), null);
  const retained = contract.compilePrompt({ input: replay }, { retained: true, checkpoint: previous });
  assert.equal(retained.images.length, 0);
  replay[0].content[0].image_url = 'data:image/png;base64,AQ==';
  assert.equal(contract.canonicalSuffix(previous, contract.normalizeInput({ input: replay }).records), null);
});
test('message shorthand, tool-result image and opaque protocol preflight are lossless or explicit', () => {
  const request = { input: [{ role: 'developer', content: 'rule' },
    { type: 'function_call_output', call_id: 'image-call', output: { session_id: 7, content: [{ type: 'image', mimeType: 'image/png', data: 'AA==' }] } }] };
  const result = contract.normalizeInput(request);
  assert.equal(result.records[0].type, 'message'); assert.equal(result.records[0].role, 'developer');
  assert.equal(result.images.length, 1); assert.equal(result.images[0].source, 'data:image/png;base64,AA==');
  assert.equal(result.records[1].output.session_id, 7);
  assert.throws(() => contract.normalizeInput({ input: [{ type: 'compaction', encrypted_content: 'opaque-native' }] }), /unsupported|opaque/i);
  assert.throws(() => contract.normalizeInput({ input: [{ type: 'message', role: 'user', content: [{ type: 'encrypted_content', encrypted_content: 'opaque-native' }] }] }), /encrypted/i);
});
test('browser transport distinguishes characters, bytes, token bounds and provider usage', () => {
  const limits = contract.promptBudget('é'.repeat(1000), { effortIndex: 2, proAvailable: false, images: [] });
  assert.equal(limits.characters, 1000); assert.equal(limits.bytes, 2000);
  assert.equal(limits.estimated, true); assert.equal(limits.providerUsage, null);
  assert.equal(limits.composerCharLimit, 1048572);
});
test('ordinary 100KB context is counted with o200k tokens, not rejected as 100K tokens', () => {
  const text = 'native tool evidence. '.repeat(5000);
  const budget = contract.promptBudget(text, { effortIndex: 1, proAvailable: true });
  assert.ok(budget.estimatedTokens < budget.bytes / 2);
  assert.equal(budget.tokenizer, 'o200k_base');
  assert.equal(budget.providerUsage, null);
  assert.equal(budget.bytes, Buffer.byteLength(text));
});
