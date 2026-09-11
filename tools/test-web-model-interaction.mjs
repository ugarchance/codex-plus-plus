import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('model picker opens the hidden family view, proves selection, then drives the slider owner', async () => {
  let menu = false, families = false, selected = false, effort = 1, hiddenClicks = 0;
  const document = { activeElement: null };
  const node = (text, role, attrs = {}) => ({ innerText: text, parentElement: null,
    getAttribute(name) { if (name === 'role') return role; const value = attrs[name]; return typeof value === 'function' ? value() : value ?? null; },
    getBoundingClientRect: () => ({ x: 20, y: 20, width: 100, height: 30 }),
    focus() { document.activeElement = this; }, contains(e) { return e === this; },
  });
  const trigger = node('Medium', 'button', { 'aria-expanded': () => String(menu) });
  const toggle = node('Select model', 'menuitem', { 'aria-expanded': () => String(families) });
  const family = node('GPT-5.6 Sol', 'menuitemradio', { 'aria-checked': () => String(selected) });
  const sliderOwner = node('', 'menuitem');
  // Radix disables the body while the portaled menu restores pointer-events:auto.
  const body = node('', 'body');
  toggle.parentElement = body; family.parentElement = body; sliderOwner.parentElement = body;
  const slider = node('', 'slider', { 'aria-valuemin': '0', 'aria-valuemax': '4', 'aria-valuenow': () => String(effort) });
  slider.closest = () => sliderOwner;
  slider.parentElement = sliderOwner;
  const composer = node('', 'textbox');
  const scope = { parentElement: null, querySelectorAll: () => [trigger] };
  composer.closest = () => scope;
  document.querySelector = selector => {
    if (selector.includes('prompt-textarea')) return composer;
    if (selector.includes('slider')) return menu ? slider : null;
    return null;
  };
  document.querySelectorAll = selector => {
    if (selector.includes('menuitemradio')) return menu ? [family] : [];
    if (selector.includes('aria-expanded')) return menu ? [toggle] : [];
    if (selector.includes('slider')) return menu ? [slider] : [];
    return [];
  };
  const getComputedStyle = element => ({ display: 'block', visibility: 'visible',
    opacity: element === family && !families ? '0' : '1',
    pointerEvents: element === body || (element === family && !families) ? 'none' : 'auto' });
  class BrowserWindow extends EventEmitter {
    constructor() { super(); this.webContents = {
      on() {}, setUserAgent() {}, executeJavaScript: expression => vm.runInNewContext(expression, { document, getComputedStyle }),
      sendInputEvent(event) {
        if (event.type === 'mouseUp' && !families) hiddenClicks++;
        if (event.type !== 'keyDown') return;
        const active = document.activeElement;
        if (event.keyCode === 'Return') {
          if (active === trigger) menu = !menu;
          if (active === toggle && menu) families = !families;
          if (active === family && families) { selected = true; families = false; }
        }
        if (event.keyCode === 'Escape') { menu = false; families = false; }
        if (active === sliderOwner && menu && !families && ['Left', 'Right'].includes(event.keyCode)) effort += event.keyCode === 'Right' ? 1 : -1;
      },
    }; }
    show() {} isDestroyed() { return false; } loadURL() {} destroy() { this.emit('closed'); }
  }
  const module = { exports: {} };
  const localRequire = name => name === 'electron' ? { BrowserWindow, session: { fromPartition() {} }, app: { userAgentFallback: 'fixture' } }
    : name.startsWith('./') ? require('../hub/' + name.slice(2)) : require(name);
  const code = fs.readFileSync(new URL('../hub/web-session.cjs', import.meta.url), 'utf8');
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
    console, Buffer, process, setTimeout: fn => setTimeout(fn, 0), clearTimeout,
  })(localRequire, module, module.exports);
  const web = module.exports; web.open();
  const result = await web.setEffort(3);
  assert.equal(result.applied, true);
  assert.equal(result.now, 3);
  assert.equal(selected, true);
  assert.equal(hiddenClicks, 0);
  assert.equal(menu, false);
});
