import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import patch from '../patch/patches/120-web-models.mjs';
const require = createRequire(import.meta.url);
function renderer() {
  let route = null;
  const ctx = vm.createContext({ structuredClone, setTimeout, __codexpp: { gatewayRoute: () => route } });
  vm.runInContext(patch.apply('class Client { send(m,p,o,e){let{request:r,promise:q}=this.createRequest(m,p,o,e); return q;} }'), ctx);
  return { ctx, ready(port = 1) { route = { ready: true, generation: port, baseUrl: `http://127.0.0.1:${port}`, catalogPath: 'C:/fixture/catalog.json', models: [{ slug: 'chatgpt-web/sol-full' }], supportedModels: ['chatgpt-web/sol-full', 'chatgpt-web/sol'] }; } };
}
test('null route recovers, restart port refreshes, and native flags are not forced', () => {
  const f = renderer(), native = { model: 'gpt-5.6-sol', config: { features: { code_mode: false }, x: 1 } };
  assert.equal(f.ctx.__cxpParams('thread/start', native, { hostId: 'local' }), native);
  f.ready();
  const first = f.ctx.__cxpParams('thread/start', native, { hostId: 'local' });
  assert.equal(first.config.features.code_mode, false);
  assert.equal(first.config.model_catalog_json, undefined); // real engine ignores per-thread catalog overrides
  f.ready(2);
  for (const method of ['thread/resume', 'thread/fork']) assert.match(f.ctx.__cxpParams(method, { threadId: 'existing' }, { hostId: 'local' }).config.openai_base_url, /:2$/);
  const full = f.ctx.__cxpParams('thread/start', { model: 'chatgpt-web/sol-full' }, { hostId: 'local' });
  assert.equal(full.config.features, undefined);
});
test('engine startup gets Web catalog only on the local app route, without changing native flags', () => {
  const { engineArgs } = require('../hub/web-model-catalog.cjs');
  const original = ['-c', 'features.code_mode_host=true', 'app-server', '--analytics-default-enabled'];
  const prepare = () => ({ catalogPath: "C:/space and 'quote/catalog.json" });
  assert.equal(engineArgs(original, { id: 'remote' }, prepare), original);
  assert.equal(engineArgs(original, { id: 'wsl:fixture' }, prepare), original);
  const local = engineArgs(original, { id: 'local' }, prepare, () => 'http://127.0.0.1:1234/backend-api/codex');
  assert.deepEqual(local.slice(0, original.length), original);
  assert.equal(JSON.parse(local[original.length + 1].split('=').slice(1).join('=')), prepare().catalogPath);
  assert.equal(local[original.length + 3], 'openai_base_url="http://127.0.0.1:1234/backend-api/codex"');
  const explicit = ['-c', 'openai_base_url="https://explicit.invalid"', ...original];
  assert.equal(engineArgs(explicit, { id: 'local' }, prepare), explicit);
});
test('remote Web and unknown Web slug reject; native and cxp remote requests stay untouched', () => {
  const f = renderer(); f.ready();
  assert.throws(() => f.ctx.__cxpParams('thread/start', { model: 'chatgpt-web/sol-full' }, { hostId: 'remote' }), /local/);
  assert.throws(() => f.ctx.__cxpParams('thread/start', { model: 'chatgpt-web/typo' }, { hostId: 'local' }), /unsupported/);
  for (const model of ['gpt-5.6-sol', 'cxp/account/model']) {
    const p = { model }; assert.equal(f.ctx.__cxpParams('thread/start', p, { hostId: 'remote' }), p);
  }
});
test('Web native catalog preserves every original row and owns its limits and tool protocol', () => {
  const { augmentCatalog } = require('../hub/web-model-catalog.cjs');
  const native = { slug: 'gpt-5.6-sol', visibility: 'list', supported_reasoning_levels: [{ effort: 'high' }],
    tool_mode: 'code_mode_only', apply_patch_tool_type: 'freeform', multi_agent_version: 'v2', comp_hash: 'native', context_window: 272000 };
  const input = { models: [native], etag: 'fixture' }, before = JSON.stringify(input);
  const output = augmentCatalog(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(output.models[0], native);
  const web = output.models.find(x => x.slug === 'chatgpt-web/sol-full');
  assert.equal(web.apply_patch_tool_type, 'freeform'); assert.equal(web.tool_mode, null);
  assert.equal(web.multi_agent_version, 'v2'); assert.equal(web.comp_hash, undefined);
  assert.equal(output.models.find(x=>x.slug==='chatgpt-web/sol').multi_agent_version,'disabled');
  assert.equal(web.context_window, 41000); // lowest supported effort; browser preflight owns account-specific budgets
  assert.equal(web.service_tiers.length, 0);
  const unsupported = augmentCatalog({models:[{...native,multi_agent_version:'disabled'}]}).models.find(x=>x.slug==='chatgpt-web/sol-full');
  assert.equal(unsupported.multi_agent_version,'disabled');
  assert.doesNotMatch(unsupported.description,/plaintext subagents/);
});
