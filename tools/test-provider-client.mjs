import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import patch, {catalogPatch} from '../patch/patches/121-provider-client.mjs';

function fixture(defaultModel = 'gpt-5.6-sol') {
  const sent = [], routed = new Map(), prepared = [];
  const model = 'cxp/example/model';
  const api = { onNativeSelect() {}, onChange() {}, async call(method, ...args) {
    let data;
    if (method === 'prepare') {
      prepared.push(args[0]);
      data = { ticket: 'ticket', modelProvider: 'cxp-external', config: {
        model_reasoning_effort: 'medium', 'model_providers.cxp-external': { base_url: 'http://127.0.0.1/fixture', requires_openai_auth: false },
      } };
    } else if (method === 'route') data = routed.get(args[0]);
    else if (method === 'bind') routed.set(args[1], { modelId: prepared.at(-1) });
    else if (method === 'catalog') data = [{ model }];
    return { ok: true, data };
  } };
  const client = { hostId: 'local', async sendRequest(method, params) {
    sent.push({ method, params });
    if (method === 'config/read') return { config: { model: defaultModel } };
    if (method === 'model/list') return { data: [{ model: 'gpt-5.6-sol' }] };
    if (method.startsWith('thread/')) return { thread: { id: 'new-thread' } };
    return {};
  } };
  const context = vm.createContext({ __cxpProviders: api });
  const source = `class Manager{constructor(client){if(client.hostId==='bad')throw Error('does not match AppServerManager hostId');this.requestClient=client;let restricted=this.settings.restricted;}}
  function normalize({models,enabledReasoningEfforts,hasConfiguredModelCatalog,useHiddenModels}) {
    const filtered=models.map(m=>({...m,supportedReasoningEfforts:m.supportedReasoningEfforts.filter(e=>enabledReasoningEfforts.has(e.reasoningEffort))}));
    return {models:filtered,defaultModel:filtered[0],hasModelSupportingMaxReasoningEffort:true};
  }`;
  vm.runInContext(catalogPatch.apply(patch.apply(source)), context);
  context.__cxpInstallProviders(client);
  return { client, sent, routed, prepared, model, normalize: context.normalize };
}

test('selected effort and unrelated thread overrides survive route preparation', async () => {
  const f = fixture();
  await f.client.sendRequest('thread/start', { model: f.model, config: { model_reasoning_effort: 'max', personality: 'pragmatic' } });
  const request = f.sent.at(-1).params;
  assert.equal(request.config.model_reasoning_effort, 'max');
  assert.equal(request.config.personality, 'pragmatic');
  assert.equal(request.modelProvider, 'cxp-external');
  assert.equal(request.config['model_providers.cxp-external'].requires_openai_auth, false);
  assert.equal(f.routed.get('new-thread').modelId, f.model);
});

test('an omitted draft model resolves the private config before choosing the provider', async () => {
  const f = fixture('cxp/example/model');
  await f.client.sendRequest('thread/start', { cwd: '/fixture', model: null });
  assert.equal(f.sent.at(-1).params.modelProvider, 'cxp-external');
  assert.equal(f.sent.at(-1).params.model, f.model);
});

test('Plan mode cannot silently send an external model to a ChatGPT thread', async () => {
  const f = fixture();
  await assert.rejects(f.client.sendRequest('turn/start', { threadId: 'native-thread', collaborationMode: { mode: 'plan', settings: { model: f.model, reasoning_effort: 'high' } } }), /new chat/);
  assert.equal(f.sent.length, 0);
});

test('Plan mode on a routed thread preserves its model and effort', async () => {
  const f = fixture();
  f.routed.set('external-thread', { modelId: f.model });
  const params = { threadId: 'external-thread', collaborationMode: { mode: 'plan', settings: { model: f.model, reasoning_effort: 'max' } } };
  await f.client.sendRequest('turn/start', params);
  assert.equal(f.sent.at(-1).params, params);
});

test('native resume never adopts the external default for new chats', async () => {
  const f = fixture('cxp/example/model');
  await f.client.sendRequest('thread/resume', { threadId: 'native-thread' });
  assert.equal(f.prepared.length, 0);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].params.modelProvider, undefined);
});

test('saved external routes are restored on resume', async () => {
  const f = fixture();
  f.routed.set('external-thread', { modelId: f.model });
  await f.client.sendRequest('thread/resume', { threadId: 'external-thread' });
  assert.equal(f.sent.at(-1).params.modelProvider, 'cxp-external');
});

test('explicit native model selection remains native', async () => {
  const f = fixture('cxp/example/model');
  const params = { model: 'gpt-5.6-sol' };
  await f.client.sendRequest('thread/start', params);
  assert.equal(f.prepared.length, 0);
  assert.equal(f.sent.at(-1).params, params);
});

test('provider efforts survive native feature flags while native filtering is preserved', () => {
  const f = fixture();
  const efforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(reasoningEffort => ({ reasoningEffort }));
  const models = [{ model: 'native', supportedReasoningEfforts: efforts }, { model: f.model, supportedReasoningEfforts: efforts }];
  const result = f.normalize({ models, enabledReasoningEfforts: new Set(['medium']) });
  assert.deepEqual(Array.from(result.models[0].supportedReasoningEfforts, e=>e.reasoningEffort), ['medium']);
  assert.equal(result.models[1], models[1]);
  assert.equal(result.models.length, 2);
});

test('remote hosts do not advertise locally connected providers', async () => {
  const f = fixture();
  f.client.hostId = 'remote';
  const result = await f.client.sendRequest('model/list', {});
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].model, 'gpt-5.6-sol');
});
