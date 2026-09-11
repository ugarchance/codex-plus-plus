import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('Web checkpoint to native transition preserves summary and call identity without sending a local encrypted envelope', async () => {
  const gateway = require('../hub/gateway.cjs'), realFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (_url, options) => { forwarded = options; return new Response('fixture', { status: 200 }); };
  const body = { model: 'gpt-5.6-sol', input: [
    { type: 'compaction', id: 'local-checkpoint', encrypted_content: 'ocx1:' + Buffer.from('fixture summary').toString('base64') },
    { type: 'function_call', id: 'local-tool-item', call_id: 'same-call', name: 'exec_command', arguments: '{"cmd":"fixture"}' },
    { type: 'function_call_output', call_id: 'same-call', output: 'evidence' },
    { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==' }] },
  ] };
  try {
    const { baseUrl } = await gateway.start();
    const response = await realFetch(`${baseUrl}/responses`, { method: 'POST', body: gzipSync(JSON.stringify(body)),
      headers: { 'content-encoding': 'gzip', authorization: 'Bearer fixture', 'chatgpt-account-id': 'fixture-account' } });
    assert.equal(response.status, 200); await response.text();
    assert.equal(forwarded.headers['content-encoding'], undefined, 'rewritten body cannot keep its former compression header');
    const native = JSON.parse(forwarded.body);
    assert.equal(native.input[0].type, 'message');
    assert.equal(native.input[0].role, 'user');
    assert.match(native.input[0].content[0].text, /fixture summary/);
    assert.equal(native.input[1].id, undefined);
    assert.equal(native.input[1].call_id, 'same-call');
    assert.deepEqual(native.input.slice(2), body.input.slice(2));
    assert.equal(forwarded.headers.authorization, 'Bearer fixture');
    assert.equal(forwarded.headers['chatgpt-account-id'], 'fixture-account');
    forwarded = null;
    const invalid = await realFetch(`${baseUrl}/responses`, { method: 'POST', body: JSON.stringify({ ...body, input: [
      { type: 'compaction', encrypted_content: 'ocx1:not valid!' },
    ] }) });
    assert.equal(invalid.status, 400); await invalid.text();
    assert.equal(forwarded, null, 'invalid local checkpoints must never reach upstream');
    const incomplete = await realFetch(`${baseUrl}/responses`, { method: 'POST', body: JSON.stringify({
      ...body, previous_response_id: 'provider-local-reference',
    }) });
    assert.equal(incomplete.status, 400); await incomplete.text();
    assert.equal(forwarded, null, 'a local reference must not silently replace missing canonical history');
  } finally { globalThis.fetch = realFetch; await gateway.stop(); }
});

test('authenticated models refresh preserves native rows and adds the Web tool contract', async () => {
  const gateway = require('../hub/gateway.cjs');
  const realFetch = globalThis.fetch;
  const native = { slug: 'gpt-5.6-sol', visibility: 'list', supported_reasoning_levels: [{ effort: 'high' }],
    apply_patch_tool_type: 'freeform', tool_mode: 'code_mode_only', context_window: 272000 };
  let status = 200;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://chatgpt.com/backend-api/codex/models?client_version=fixture');
    assert.equal(options.headers.authorization, 'Bearer fixture');
    assert.equal(options.headers['chatgpt-account-id'], 'fixture-account');
    return new Response(status === 200 ? JSON.stringify({ models: [native], extra: 'preserved' }) : 'native unauthorized',
      { status, headers: { 'content-type': 'application/json', etag: 'native-etag' } });
  };
  try {
    const { baseUrl } = await gateway.start();
    const request = () => realFetch(`${baseUrl}/models?client_version=fixture`, { headers: { authorization: 'Bearer fixture', 'chatgpt-account-id': 'fixture-account' } });
    const response = await request(), body = await response.json();
    assert.deepEqual(body.models[0], native);
    assert.equal(body.extra, 'preserved');
    assert.equal(body.models.find(x => x.slug === 'chatgpt-web/sol-full')?.apply_patch_tool_type, 'freeform');
    assert.notEqual(response.headers.get('etag'), 'native-etag');
    status = 401;
    const denied = await request();
    assert.equal(denied.status, 401); assert.equal(await denied.text(), 'native unauthorized');
  } finally { globalThis.fetch = realFetch; await gateway.stop(); }
});

test('native responses/compact and unrelated endpoints preserve body, auth, account and upstream status', async () => {
  const gateway = require('../hub/gateway.cjs');
  const realFetch = globalThis.fetch;
  const received = [];
  globalThis.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/chatgpt\.com\/backend-api\/codex\//);
    received.push({ url, ...options });
    return new Response('native upstream fixture', { status: 429, headers: { 'x-request-id': 'native-fixture', 'content-type': 'text/plain' } });
  };
  try {
    const { baseUrl } = await gateway.start();
    for (const endpoint of ['responses', 'responses/compact', 'usage?window=short']) {
      const body = gzipSync(JSON.stringify({ model: 'gpt-5.6-sol', input: endpoint === 'usage?window=short' ? 'fixture' : [
        { type: 'compaction', id: 'native-owned-id', encrypted_content: 'opaque-native-fixture' },
        { role: 'user', content: 'fixture' },
      ], tools: [{ type: 'custom', name: 'native_only' }] }));
      const response = await realFetch(`${baseUrl}/${endpoint}`, { method: 'POST', body, headers: {
        authorization: 'Bearer fixture-not-a-secret', 'chatgpt-account-id': 'fixture-account',
        'content-encoding': 'gzip', 'content-type': 'application/json', 'x-native-header': 'preserved',
      } });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('x-request-id'), 'native-fixture');
      assert.equal(await response.text(), 'native upstream fixture');
      const forwarded = received.at(-1);
      assert.equal(forwarded.url, `https://chatgpt.com/backend-api/codex/${endpoint}`);
      assert.deepEqual(forwarded.body, body);
      assert.equal(forwarded.headers.authorization, 'Bearer fixture-not-a-secret');
      assert.equal(forwarded.headers['chatgpt-account-id'], 'fixture-account');
      assert.equal(forwarded.headers['content-encoding'], 'gzip');
      assert.equal(forwarded.headers['x-native-header'], 'preserved');
      assert.equal(forwarded.headers.host, undefined);
    }
    assert.equal(received.length, 3);
  } finally { globalThis.fetch = realFetch; await gateway.stop(); }
});
