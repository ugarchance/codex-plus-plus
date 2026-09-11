import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const web = require('../hub/web-session.cjs');

test('fresh chat establishes ownership before selecting its connector', async () => {
  const source=fs.readFileSync(new URL('../hub/web-session.cjs',import.meta.url),'utf8');
  const implementation=source.slice(source.indexOf('async function openChat('),source.indexOf('// ProseMirror renders'));
  let owned=false;
  const open=vm.runInNewContext(implementation+'\nopenChat',{
    chatHistoryMode:()=> 'normal',NORMAL_CHAT_URL:'https://chatgpt.com/',window:{webContents:{loadURL:async()=>{}}},chromeUserAgent:()=> 'fixture',
    COMPOSER_SELECTOR:"'#prompt-textarea'",waitFor:async()=>true,sleep:async()=>{},
    evaluate:async text=>{if(text.includes('__codexppComposerMutation'))owned=true;return{query:false,visible:false}},
    beginOwnedComposer:web.beginOwnedComposer,readComposerText:web.readComposerText,
    step:async(_label,fn)=>fn(),attachPlugin:async()=>{assert.equal(owned,true);return{attached:true}},
  });
  assert.equal((await open({harness:true,effortIndex:null})).plugin.attached,true);
});

test('composer rollback only owns the exact unsent draft, uploaded names and selected connector', () => {
  const pill={getAttribute:()=> 'plugin:fixture'}, group={getAttribute:()=> 'owned.png'};
  const form={querySelectorAll:s=>s.includes('role="group"')?[group]:[pill]};
  const c={closest:()=>form,value:'fixture-prefix'};
  const location={href:'https://chatgpt.com/'}, window={__codexppComposerMutation:{element:c,url:location.href,mention:'',imageNames:['owned.png'],pill,submitted:false},__codexppOwnedInsertion:{element:c,url:location.href,before:'',prompt:'fixture-prefix-and-rest'}};
  const document={querySelector:()=>c};
  const plan=()=>vm.runInNewContext(`(${web.ownedRollbackPlan.toString()})(${(x=>x.value).toString()})`,{window,document,location});
  assert.equal(plan().groups.length,1);
  window.__codexppOwnedInsertion.before='\n';c.value='\nfixture-prefix';assert.equal(plan().groups.length,1);
  window.__codexppOwnedInsertion.before='';c.value='fixture-prefix';
  const remountedPill={getAttribute:()=> 'plugin:fixture'};
  form.querySelectorAll=s=>s.includes('role="group"')?[group]:[remountedPill];
  assert.equal(plan().pills[0],remountedPill,'same connector identity can remount within the unchanged editor');
  form.querySelectorAll=s=>s.includes('role="group"')?[group]:[pill];
  c.value+=' USER EDIT'; assert.equal(plan(),null); c.value='';
  form.querySelectorAll=s=>s.includes('role="group"')?[group,{getAttribute:()=> 'user.png'}]:[pill];
  assert.equal(plan(),null,'never remove user attachments');
  form.querySelectorAll=s=>s.includes('role="group"')?[group]:[pill];
  window.__codexppComposerMutation.submitted=true; assert.equal(plan(),null);
  window.__codexppComposerMutation.submitted=false; location.href+='other'; assert.equal(plan(),null);
});

test('submission uses the focused send control and still requires semantic acceptance', async () => {
  const source = fs.readFileSync(new URL('../hub/web-session.cjs', import.meta.url), 'utf8');
  const implementation = source.slice(source.indexOf('async function submitPrompt('), source.indexOf('\nasync function stopGeneration('));
  const document = { activeElement: null };
  const button = { disabled: false, getBoundingClientRect: () => ({ x: 1372, y: 760, width: 40, height: 40 }), focus() { document.activeElement = this; } };
  const form = { querySelector: () => button };
  const composer = { closest: () => form };
  composer.value = 'fixture';
  const location = { href: 'https://chatgpt.com/c/fixture' };
  const window = { __codexppOwnedInsertion: { element: composer, before: '', prompt: 'fixture', url: location.href } };
  document.querySelector = selector => selector.includes('prompt-textarea') ? composer : button;
  let sent = 0, acceptance = false;
  const submit = vm.runInNewContext(implementation + '\nsubmitPrompt', {
    evaluate: async expression => vm.runInNewContext(expression, { document, window, location }),
    verifyOwnedSubmission: web.verifyOwnedSubmission, readComposerText: c => c.value,
    ownedRollbackPlan: web.ownedRollbackPlan,
    promptLanded: web.promptLanded,
    mouse() { assert.fail('submission must use the focused send control, independent of pointer zoom'); },
    key(name) { assert.equal(document.activeElement, button); assert.equal(name, 'Return'); sent++; },
    acceptedSubmission: web.acceptedSubmission, readTurnDomState() {},
    waitFor: async () => { if (!acceptance) throw new Error('no semantic submission evidence'); return { lastUserId: 'accepted' }; },
  });
  await assert.rejects(submit({ userCount: 0 }, 'fixture'), /semantic submission evidence/);
  assert.equal(sent, 1);
  window.__codexppOwnedInsertion.submissionAttempted = false;
  acceptance = true;
  assert.equal((await submit({ userCount: 0 }, 'fixture')).lastUserId, 'accepted');
  assert.equal(sent, 2);
  await assert.rejects(submit({ userCount: 0 }, 'fixture'), /ownership|changed|attempted/i);
  assert.equal(sent, 2, 'an uncertain accepted Send must never be replayed');
  window.__codexppOwnedInsertion.submissionAttempted = false;
  composer.value = 'user changed the draft';
  await assert.rejects(submit({ userCount: 0 }, 'fixture'), /ownership|changed/i);
  assert.equal(sent, 2);
  composer.value = 'fixture';
  window.__codexppOwnedInsertion.element = {};
  await assert.rejects(submit({ userCount: 0 }, 'fixture'), /ownership|changed/i);
  assert.equal(sent, 2, 'remounted editor must not inherit insertion authority');
  window.__codexppOwnedInsertion.element = composer;
  location.href = 'https://chatgpt.com/c/another';
  await assert.rejects(submit({ userCount: 0 }, 'fixture'), /ownership|changed/i);
  assert.equal(sent, 2);
});
test('browser pointer coordinates honor the observed page zoom', () => {
  assert.deepEqual(web.inputPoint(1372, 760, 0.7575757503509521), { x: 1039, y: 576 });
  assert.deepEqual(web.inputPoint(100, 50, 1.5), { x: 150, y: 75 });
});
test('normal history requires an explicit choice; absence and invalid values never enable it', () => {
  assert.equal(web.chatHistoryMode(''), 'temporary');
  assert.equal(web.chatHistoryMode('temporary'), 'temporary');
  assert.equal(web.chatHistoryMode('normal'), 'normal');
  assert.throws(() => web.chatHistoryMode('auto'), /explicit|unsupported/i);
});
test('an exact retained conversation reuses its proven connector without reopening mention selection', async () => {
  const source = fs.readFileSync(new URL('../hub/web-session.cjs', import.meta.url), 'utf8');
  const implementation = source.slice(source.indexOf('async function turn('), source.indexOf('\nfunction cancellationError('));
  const conversation = { key: 'task', url: 'https://chatgpt.com/c/retained', effortIndex: null, harness: true, historyMode: 'normal', plugin: { attached: true } };
  let sends = 0;
  const run = vm.runInNewContext(implementation + '\nturn', {
    conversation, require: createRequire(new URL('../hub/web-session.cjs', import.meta.url)), process: { env: {} }, open() {}, chatHistoryMode: () => 'normal',
    window: { webContents: { getURL: () => conversation.url } }, composerPresent: async () => true,
    pluginAttached: async () => false, attachPlugin: async () => { throw new Error('retained connector cannot be mentioned again'); },
    step: async (_label, fn) => fn(), buildOutgoingPrompt: web.buildOutgoingPrompt,
    evaluate: async () => true, beginOwnedComposer: web.beginOwnedComposer, readComposerText: web.readComposerText,
    submissionSnapshot: async () => ({}), attachImages: async () => ({ cleanup() {} }), typePrompt: async () => {},
    submitPrompt: async () => { sends++; return { url: conversation.url }; }, readAnswer: async () => 'verified final',
  });
  assert.equal((await run({ key: 'task', prompt: 'followup', effortIndex: null, harness: true, token: 'fresh' })).reused, true);
  assert.equal(sends, 1);
  conversation.plugin = null;
  await assert.rejects(run({ key: 'task', prompt: 'followup', effortIndex: null, harness: true, token: 'next' }), /connector.*binding|bound connector/i);
  assert.equal(sends, 1);
});
test('composer equality rejects extra prefix and whitespace mutation', () => {
  assert.equal(web.promptLanded('', 'unexpected\nprompt', 'prompt'), false);
  assert.equal(web.promptLanded('', ' prompt ', 'prompt'), false);
  assert.equal(web.promptLanded('', 'a\u00a0 b', 'a  b'), true);
  assert.equal(web.promptLanded('', 'a\u00a0b', 'a b'), false);
});

test('partial draft rollback undoes only the owned unchanged editor transaction, preserving user edits and remounts', () => {
  assert.equal(typeof web.restoreOwnedInsertion, 'function');
  const composer = { value: 'part', focus() {} };
  const window = { __codexppOwnedInsertion: { element: composer, before: '', prompt: 'partial prompt' } };
  let undos = 0;
  const document = { querySelector: () => composer, execCommand: command => { assert.equal(command, 'undo'); undos++; composer.value = ''; return true; } };
  const restore = vm.runInNewContext('(' + web.restoreOwnedInsertion.toString() + ')', { window, document });
  assert.equal(restore('part', c => c.value), true);
  assert.equal(undos, 1); assert.equal(composer.value, '');
  window.__codexppOwnedInsertion = { element: composer, before: '', prompt: 'partial prompt' };
  composer.value = 'user edited the draft';
  assert.equal(restore('part', c => c.value), false); assert.equal(undos, 1);
  composer.value = 'part'; window.__codexppOwnedInsertion = { element: {}, before: '', prompt: 'partial prompt' };
  assert.equal(restore('part', c => c.value), false); assert.equal(undos, 1);
  const owned = {element:composer,before:'',prompt:'partial prompt'};
  window.__codexppOwnedInsertion=owned;
  document.execCommand=()=>false;
  assert.equal(restore('part', c=>c.value),false);
  assert.equal(window.__codexppOwnedInsertion,owned,'failed editor undo must retain authority for guarded attachment/draft rollback');
});
test('terminal answer proof requires the bound response identity, not greater DOM counts', () => {
  const submission = { url: 'https://chatgpt.com/c/fixture', assistantCount: 1, lastAssistantId: 'old', responseId: 'bound' };
  assert.equal(web.responseBelongsToSubmission({ url: submission.url, count: 20, id: 'unrelated' }, submission), false);
  assert.equal(web.responseBelongsToSubmission({ url: submission.url, count: 1, id: 'bound' }, submission), true);
});
test('normal chat may acquire its saved URL once, but must retain the accepted user and assistant identities', () => {
  const submission = { url: 'https://chatgpt.com/?model=gpt-5-6', lastUserId: 'user', responseId: 'answer', turnIds: [] };
  const state = { url: 'https://chatgpt.com/c/6aa3bddb-70d8-83eb-9647-9d0bb54fe00f', id: 'answer', userIds: ['user'] };
  assert.equal(web.responseBelongsToSubmission(state, submission), true);
  assert.equal(web.responseBelongsToSubmission({ ...state, id: 'other' }, submission), false);
  assert.equal(web.responseBelongsToSubmission({ ...state, userIds: ['other'] }, submission), false);
  assert.equal(web.responseBelongsToSubmission(state, { ...submission, url: 'https://chatgpt.com/?temporary-chat=true' }), false);
  assert.equal(web.responseBelongsToSubmission(state, { ...submission, url: 'https://chatgpt.com/c/another' }), false);
  const provisional = 'https://chatgpt.com/c/WEB:67f25521-07d9-488a-80f8-95bf8fc6b4fa';
  assert.equal(web.responseBelongsToSubmission({ ...state, url: provisional }, submission), true);
  assert.equal(web.responseBelongsToSubmission(state, { ...submission, url: provisional }), true);
  assert.equal(web.responseBelongsToSubmission({ ...state, url: 'https://chatgpt.com/c/WEB:11111111-1111-1111-1111-111111111111' }, { ...submission, url: provisional }), false);
});

test('collapsed user text and virtualized old turns do not lose stable submission identity', () => {
  const before = { turnIds: ['old-user', 'old-answer'], userIds: ['old-user'], assistantIds: ['old-answer'] };
  const current = { url: 'https://chatgpt.com/c/fixture', turnIds: ['old-user', 'old-answer', 'new-user', 'new-answer'], userIds: ['new-user'], assistantIds: ['new-answer'] };
  assert.equal(web.acceptedSubmission(before, current).lastUserId, 'new-user');
  assert.equal(web.acceptedSubmission(before, { ...current, userIds: ['old-user'], assistantIds: ['old-answer'] }), null);
  assert.throws(() => web.acceptedSubmission(before, { ...current, userIds: ['new-user', 'new-user'] }), /duplicate|identity/i);
  assert.throws(() => web.acceptedSubmission(before, { ...current, userIds: ['new-user', 'unknown'] }), /identity|unbound/i);
});

test('new assistant identity proves submission even when the user container already existed in the baseline', () => {
  const before = { turnIds: ['reserved-user'], userIds: [], assistantIds: [] };
  const current = { url: 'https://chatgpt.com/c/fixture', turnIds: ['reserved-user', 'new-answer'], userIds: ['reserved-user'], assistantIds: ['new-answer'] };
  assert.equal(web.acceptedSubmission(before, current)?.responseId, 'new-answer');
});

test('visible final copy action is terminal even when empty composer replaces Send with Voice', () => {
  const root = { getAttribute: () => 'new-answer', querySelectorAll: selector => selector === '[role="alert"]' ? [] : [{ innerText: 'visible answer' }], querySelector: () => ({ getBoundingClientRect: () => ({ width: 20, height: 20 }) }) };
  const document = { querySelectorAll: selector => selector.includes('data-turn="assistant"') ? [root] : [], querySelector: () => null };
  assert.equal(typeof web.readVisibleAnswer, 'function');
  const read = vm.runInNewContext('(' + web.readVisibleAnswer.toString() + ')', { document, location: { href: 'https://chatgpt.com/c/fixture' } });
  const state = read({ responseId: 'new-answer', turnIds: [] });
  assert.equal(state.text, 'visible answer');
  assert.equal(state.terminal, true);
  assert.equal(state.streaming, false);
});

test('deadline cannot return stable partial text when the native completion fence never commits', async () => {
  const source = fs.readFileSync(new URL('../hub/web-session.cjs', import.meta.url), 'utf8');
  const implementation = source.slice(source.indexOf('async function readAnswer('), source.indexOf('\nasync function submissionSnapshot('));
  let now = 1;
  const read = vm.runInNewContext(implementation + '\nreadAnswer', {
    Date: { now: () => now }, sleep: async ms => { now += ms; },
    observe: async promise => promise,
    evaluate: async () => ({ text: 'partial fixture', id: 'bound', url: 'https://chatgpt.com/c/fixture', terminal: true, streaming: false }),
    readVisibleAnswer() {}, responseBelongsToSubmission: () => true, verifiedFinalSnapshot: web.verifiedFinalSnapshot,
    require: () => ({ beginCompletionFence: () => 1, commitCompletionFence: () => false }),
  });
  await assert.rejects(read({ submission: { url: 'https://chatgpt.com/c/fixture' }, timeoutMs: 10000, token: 'fixture' }), /verified final|timeout/);
});

test('pre-tool commentary is not a final answer after the tool has completed', async () => {
  const source = fs.readFileSync(new URL('../hub/web-session.cjs', import.meta.url), 'utf8');
  const implementation = source.slice(source.indexOf('async function readAnswer('), source.indexOf('\nasync function submissionSnapshot('));
  let now = 1;
  const read = vm.runInNewContext(implementation + '\nreadAnswer', {
    Date: { now: () => now }, sleep: async ms => { now += ms; }, observe: async promise => promise,
    evaluate: async () => ({ text: 'about to read the file', id: 'bound', url: 'https://chatgpt.com/c/fixture', terminal: true, streaming: false }),
    readVisibleAnswer() {}, responseBelongsToSubmission: () => true, verifiedFinalSnapshot: web.verifiedFinalSnapshot,
    require: () => ({ beginCompletionFence: () => 2, commitCompletionFence: () => true }),
  });
  await assert.rejects(read({ submission: { url: 'https://chatgpt.com/c/fixture' }, timeoutMs: 10000, token: 'fixture',
    getToolBaseline: () => 'about to read the file' }), /verified final|timeout/);
});

test('unresponsive browser observation is bounded and an abort settles without waiting for the renderer', async () => {
  assert.equal(typeof web.observe, 'function');
  const stuck = new Promise(() => {});
  await assert.rejects(web.observe(stuck, { timeoutMs: 10, label: 'fixture DOM' }), /fixture DOM.*timed out/);
  const controller = new AbortController();
  const observed = web.observe(stuck, { signal: controller.signal, timeoutMs: 1000 });
  controller.abort(new Error('fixture cancelled'));
  await assert.rejects(observed, /fixture cancelled/);
});

test('detached assistant rebinds only to one proven replacement without another user turn', () => {
  const root = id => ({ getAttribute: () => id, querySelector: () => null, querySelectorAll: () => [] });
  let assistants = [root('replacement')], users = [root('accepted-user')];
  const document = { querySelectorAll: selector => selector.includes('data-turn="assistant"') ? assistants : selector.includes('data-turn="user"') ? users : [] };
  const read = vm.runInNewContext('(' + web.readVisibleAnswer.toString() + ')', { document, location: { href: 'https://chatgpt.com/c/fixture' } });
  const submission = { url: 'https://chatgpt.com/c/fixture', responseId: 'detached', turnIds: ['old'], acceptedTurnIds: ['old', 'accepted-user', 'detached'] };
  assert.equal(read(submission).id, 'replacement');
  assert.equal(read(submission).reboundFrom, 'detached');
  assistants.push(root('competing'));
  assert.throws(() => read(submission), /competing/);
  assistants.pop(); users.push(root('unrelated-user'));
  assert.throws(() => read(submission), /another user|competing/);
});

test('reader retries only bounded observation timeouts, never submission or terminal errors', async () => {
  const source = fs.readFileSync(new URL('../hub/web-session.cjs', import.meta.url), 'utf8');
  const implementation = source.slice(source.indexOf('async function readAnswer('), source.indexOf('\nasync function submissionSnapshot('));
  let now = 1, probes = 0, alwaysFail = false;
  const read = vm.runInNewContext(implementation + '\nreadAnswer', {
    Date: { now: () => now }, sleep: async ms => { now += ms; }, observe: async promise => promise,
    evaluate: async () => { probes++; if (alwaysFail || probes === 1) throw Object.assign(new Error('fixture observation timed out'), { code: 'DOM_OBSERVATION_TIMEOUT' });
      return { text: 'verified fixture', id: 'bound', url: 'https://chatgpt.com/c/fixture', terminal: true, streaming: false }; },
    readVisibleAnswer() {}, responseBelongsToSubmission: () => true, verifiedFinalSnapshot: web.verifiedFinalSnapshot,
  });
  assert.equal(await read({ submission: { url: 'https://chatgpt.com/c/fixture' }, timeoutMs: 30000 }), 'verified fixture');
  probes = 0; alwaysFail = true;
  await assert.rejects(read({ submission: { url: 'https://chatgpt.com/c/fixture' }, timeoutMs: 30000 }), /observation/);
  assert.equal(probes, 8, 'the consecutive observation fault budget must be bounded');
});
