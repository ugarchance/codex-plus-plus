import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('two task owners get separate browsers; cancellation holds only its own slot through physical drain', async () => {
  const sessions=[];
  const create=()=>{
    let active=false,cancelled=false,resolve;
    const session={leaseStatus:()=>({active}),open(){return session;},close(){},status:async()=>({open:true}),resetConversation(){},commitContext(){return true;},
      cancelThread(id){if(session.owner!==id)return false;cancelled=true;return true;},cancelTurn(){return false;},
      runTurn(options){if(active)throw Error('capacity');active=true;session.owner=options.identity.threadId;
        const run=new Promise(r=>{resolve=r;});run.settlement=run.then(()=>{active=false;});return run;},
      finish(){resolve({text:session.owner,cancelled});}};
    sessions.push(session);return session;
  };
  const pool=require('../hub/web-browser-pool.cjs').createPool(create);
  const options=id=>({prompt:'fixture',identity:{threadId:id,turnId:'one'},key:id});
  const parent=pool.runTurn(options('parent')),child=pool.runTurn(options('child'));
  assert.equal(sessions.length,2);assert.throws(()=>pool.runTurn(options('third')),/capacity/);
  assert.equal(pool.cancelThread('parent','one'),true);
  assert.throws(()=>pool.runTurn(options('third')),/capacity/,'logical cancel must not release the physical slot');
  sessions[1].finish();assert.deepEqual(await child,{text:'child',cancelled:false});await child.settlement;
  const next=pool.runTurn(options('third'));sessions[1].finish();await next;await next.settlement;
  sessions[0].finish();assert.deepEqual(await parent,{text:'parent',cancelled:true});await parent.settlement;
  pool.close();
});

test('owned renderer crash aborts its lease and stale window events cannot close its successor', async () => {
  const module = { exports: {} }, windows = [];
  let release;
  const probe = new Promise(resolve => { release = resolve; });
  class BrowserWindow extends EventEmitter {
    constructor() {
      super(); windows.push(this); this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        setUserAgent() {}, getURL: () => 'https://chatgpt.com/',
        executeJavaScript: () => probe,
      });
    }
    show() {} isDestroyed() { return this.destroyed; }
    loadURL() { return Promise.resolve(); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const localRequire = name => name === 'electron' ? { BrowserWindow, session: { fromPartition() {} }, app: { userAgentFallback: 'fixture' } }
    : name.startsWith('./') ? require('../hub/' + name.slice(2)) : require(name);
  const code = fs.readFileSync(new URL('../hub/web-session.cjs', import.meta.url), 'utf8');
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { console, Buffer, process, AbortController, setTimeout, clearTimeout })(localRequire, module, module.exports);
  const web = module.exports;
  const first = web.runTurn({ prompt: 'never submitted', identity: { threadId: 'crash', turnId: 'one' } }); first.catch(() => {});
  try {
    const owned = windows[0];
    owned.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 7 });
    assert.equal(owned.isDestroyed(), true, 'the crashed physical browser must be destroyed');
    await assert.rejects(first, /renderer.*crashed/i);
    release(''); await first.settlement;
    assert.equal((await web.status()).leases.some(lease => lease.active || lease.drainFailed), false,
      'an already destroyed browser cannot leave a permanently occupied rollback lease');
    const next = web.open();
    owned.emit('closed');
    assert.equal(web.open(), next, 'late events from the previous owner must not invalidate the successor');
  } finally { first.cancel('test cleanup'); release(''); await first.settlement; web.close(); }
});
test('browser stop focuses the visible control and uses Enter even when the native window owns focus', async () => {
  const source = fs.readFileSync(new URL('../hub/web-session.cjs', import.meta.url), 'utf8');
  const implementation = source.slice(source.indexOf('async function stopGeneration('), source.indexOf('\nasync function turn('));
  const document = { activeElement: null };
  const hidden = { getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  const button = { disabled: false, getBoundingClientRect: () => ({ x: 1200, y: 900, width: 40, height: 40 }), focus() { document.activeElement = this; } };
  document.querySelector = () => button;
  document.querySelectorAll = () => [hidden, button];
  let pressed = 0, settled = 0;
  const stop = vm.runInNewContext(implementation + '\nstopGeneration', {
    window: { isDestroyed: () => false },
    evaluate: async expression => vm.runInNewContext(expression, { document }),
    mouse() { assert.fail('background stop must not depend on pointer focus'); },
    key(name) { assert.equal(document.activeElement, button); assert.equal(name, 'Return'); pressed++; },
    waitFor: async () => { settled++; },
  });
  await stop();
  assert.equal(pressed, 1);
  assert.equal(settled, 1);
  document.querySelectorAll = () => [hidden];
  await stop();
  assert.equal(pressed, 1, 'already stopped document must not receive an unrelated Enter');
});
test('a browser failure drains its physical generation before releasing the lease', async () => {
  const source = fs.readFileSync(new URL('../hub/web-session.cjs', import.meta.url), 'utf8');
  const implementation = source.slice(source.indexOf('function cancellationError('), source.indexOf('\nfunction resetConversation('));
  let release, stops = 0;
  const drain = new Promise(resolve => { release = resolve; });
  const run = vm.runInNewContext('let activeLease=null,leaseGeneration=0,conversation={};\n' + implementation + '\nrunTurn', {
    AbortController, turn: async () => { throw new Error('fixture browser failed'); },
    stopGeneration: async () => { stops++; await drain; },
  });
  const first = run({ prompt: 'read-only fixture' }); first.catch(() => {});
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stops, 1);
    assert.throws(() => run({ prompt: 'another task' }), /capacity/);
  } finally { release(); await first.settlement; }
  await assert.rejects(first, /fixture browser failed/);
});
test('cancel returns before browser preparation drains, no cancelled prompt is inserted, lease stays occupied', async () => {
  const module = { exports: {} }; let release, inserts = 0, destroyed = false;
  const navigation = new Promise(r => { release = r; });
  class BrowserWindow extends EventEmitter {
    constructor() { super(); this.webContents = {
      on() {}, setUserAgent() {}, getURL: () => 'https://chatgpt.com/?temporary-chat=true',
      loadURL: url => url.includes('temporary-chat') ? navigation : Promise.resolve(),
      executeJavaScript: async expression => {
        if (expression.includes('insertText')) inserts++;
        if (expression.includes('query: new URL')) return { visible: true, query: true };
        if (expression.includes('stop-button')) return null;
        return true;
      },
    }; }
    show() {} isDestroyed() { return destroyed; }
    loadURL(url) { return this.webContents.loadURL(url); }
    destroy() { destroyed = true; this.emit('closed'); }
  }
  const localRequire = name => name === 'electron' ? { BrowserWindow, session: { fromPartition() {} }, app: { userAgentFallback: 'fixture' } }
    : name.startsWith('./') ? require('../hub/' + name.slice(2)) : require(name);
  const code = fs.readFileSync(new URL('../hub/web-session.cjs', import.meta.url), 'utf8');
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { console, Buffer, process, AbortController, setTimeout, clearTimeout })(localRequire, module, module.exports);
  const web = module.exports;
  const turn = web.runTurn({ prompt: 'must never be submitted', identity: { threadId: 'compact-thread', turnId: 'compact-turn' } });
  await new Promise(r => setImmediate(r));
  let timer;
  try {
    assert.equal(web.cancelThread('other-thread', 'compact-turn'), false);
    assert.equal(web.cancelThread('compact-thread', 'other-turn'), false);
    assert.equal(web.cancelThread('compact-thread', 'compact-turn'), true);
    const fast = await Promise.race([turn.then(() => 'wrong', () => 'cancelled'), new Promise(r => { timer = setTimeout(() => r('late'), 80); })]);
    assert.equal(fast, 'cancelled');
    assert.throws(() => web.runTurn({ prompt: 'other task' }), /capacity/);
    release();
    await turn.settlement;
    assert.equal(inserts, 0);
  } finally { clearTimeout(timer); turn.cancel('fixture cleanup'); release(); await turn.settlement; turn.catch(() => {}); }
});
