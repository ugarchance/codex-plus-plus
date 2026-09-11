const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CONNECTOR_NAME } = require("./web-contract.cjs");

const PARTITION = "persist:codexpp-chatgpt";
const HOME_URL = "https://chatgpt.com/";

let leaseGeneration = 0;
function createSession() {
let window = null;
let activeLease = null;

function chromeUserAgent() {
  const { app } = require("electron");
  return app.userAgentFallback
    .replace(/\sElectron\/[\d.]+/, "")
    .replace(/\sCodex(\+\+)?\/[\w.+-]+/i, "");
}

function open({ show = true } = {}) {
  const { BrowserWindow, session } = require("electron");
  if (window && !window.isDestroyed()) {
    if (show) window.show();
    return window;
  }

  session.fromPartition(PARTITION);
  const userAgent = chromeUserAgent();

  window = new BrowserWindow({
    width: 1180,
    height: 860,
    show,
    title: "ChatGPT — Codex++",
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const ownedWindow = window;
  ownedWindow.on("closed", () => {
    if (window !== ownedWindow) return;
    if (activeLease) activeLease.controller.abort(new Error("the ChatGPT browser window closed"));
    if (activeLease?.drainFailed) activeLease = null;
    window = null;
    conversation = null;
  });
  // Match the reference browser host's physical renderer-loss lifecycle, scoped
  // to this owner. Never reload/replay an accepted turn after a crash.
  ownedWindow.webContents.on('render-process-gone', (_event, details) => {
    if (window !== ownedWindow) return;
    const reason = ['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure'].includes(details?.reason)
      ? details.reason : 'unknown';
    conversation = null;
    activeLease?.controller.abort(new Error(`the ChatGPT browser renderer stopped (${reason}); the accepted turn was not replayed`));
    if (!ownedWindow.isDestroyed()) ownedWindow.destroy();
  });
  window.webContents.setUserAgent(userAgent);
  window.loadURL(HOME_URL, { userAgent });
  return window;
}

async function evaluate(expression) {
  if (!window || window.isDestroyed()) throw new Error("the ChatGPT window is not open");
  return observe(window.webContents.executeJavaScript(expression, true));
}

// Bound observation separately from the user-turn deadline. A wedged renderer
// must not keep cancellation or physical-drain observation pending forever.
function observe(promise, { signal, timeoutMs = 10_000, label = 'ChatGPT DOM observation' } = {}) {
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(signal.reason ?? new Error('ChatGPT observation cancelled'));
    const timer = setTimeout(() => finish(Object.assign(new Error(`${label} timed out`), { code: 'DOM_OBSERVATION_TIMEOUT' })), Math.max(1, timeoutMs));
    Promise.resolve(promise).then(value => finish(null, value), error => finish(error));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function status() {
  if (!window || window.isDestroyed()) return { open: false };
  const url = window.webContents.getURL();
  const probe = await evaluate(`(() => ({
    readyState: document.readyState,
    signedIn: document.querySelectorAll('[data-testid*="login"], a[href*="auth/login"]').length === 0
      && document.querySelectorAll('#prompt-textarea, [contenteditable="true"]').length > 0,
    composerReady: document.querySelectorAll('#prompt-textarea, [contenteditable="true"]').length > 0,
    challenge: /just a moment|verify you are human|unusual activity|cf-chl/i.test(document.body?.innerText ?? "")
  }))()`).catch((err) => ({ error: err.message }));
  return { open: true, url, ...probe };
}

const EFFORT_PROBE = `(() => {
  const composer = document.querySelector('#prompt-textarea, [contenteditable="true"]');
  if (!composer) return { available: false, reason: "composer" };
  let scope = composer.closest("form") ?? composer.parentElement;
  for (let i = 0; i < 6 && scope?.parentElement; i++) scope = scope.parentElement;
  const trigger = [...scope.querySelectorAll('button, [role="button"]')].find(
    b => b.getAttribute("aria-expanded") !== null
      && (b.innerText ?? "").trim().length > 0
      && !/dictation|voice|files/i.test(b.getAttribute("aria-label") ?? "")
  );
  if (!trigger) return { available: false, reason: "trigger" };
  return { available: true, current: trigger.innerText.trim() };
})()`;

async function effortTrigger() {
  return evaluate(EFFORT_PROBE);
}

const COMPOSER_SELECTOR = `'#prompt-textarea, [contenteditable="true"]'`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(expression, { timeoutMs = 60_000, intervalMs = 400, label }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression).catch(() => null);
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function key(name, modifiers = []) {
  const target = window.webContents;
  target.sendInputEvent({ type: "keyDown", keyCode: name, modifiers });
  target.sendInputEvent({ type: "keyUp", keyCode: name, modifiers });
}

function selectAllModifier(platform = process.platform) {
  return platform === "darwin" ? "meta" : "control";
}

// `webContents.insertText` and the edit commands are no-ops while the window lacks OS focus, and a
// harness turn runs behind whatever the user is doing. Synthesised input events do not need it.
function typeCharacters(text) {
  for (const character of text) {
    window.webContents.sendInputEvent({ type: "char", keyCode: character });
  }
}

function inputPoint(x, y, zoom) {
  if (![x, y, zoom].every(Number.isFinite) || zoom <= 0) throw new Error('Invalid browser pointer coordinates/zoom');
  return { x: Math.round(x * zoom), y: Math.round(y * zoom) };
}

function mouse(x, y) {
  ({ x, y } = inputPoint(x, y, window.webContents.getZoomFactor?.() ?? 1));
  window.webContents.sendInputEvent({ type: "mouseMove", x, y });
  for (const type of ["mouseDown", "mouseUp"]) {
    window.webContents.sendInputEvent({ type, x, y, button: "left", clickCount: 1 });
  }
}

async function step(label, fn) {
  try {
    return await fn();
  } catch (err) {
    throw new Error(`${label}: ${err.message}`);
  }
}

async function focusComposer() {
  window.show();
  window.focus();
  window.webContents.focus();
  await sleep(200);

  // A click lands on the plugin pill when one is attached, which opens the plugin page, so click
  // the trailing edge and only when focusing the element outright did not take.
  const box = await evaluate(`(() => {
    const c = document.querySelector(${COMPOSER_SELECTOR});
    if (!c) return null;
    c.focus();
    const r = c.getBoundingClientRect();
    return {
      focused: document.activeElement === c || c.contains(document.activeElement),
      x: Math.round(r.x + r.width - 12),
      y: Math.round(r.y + r.height - 10)
    };
  })()`);
  if (!box) throw new Error("the ChatGPT composer is not present");
  if (!box.focused) {
    mouse(box.x, box.y);
    await sleep(280);
  }

  return evaluate(`(() => {
    const c = document.querySelector(${COMPOSER_SELECTOR});
    return { focused: document.activeElement === c || c?.contains(document.activeElement) };
  })()`);
}

const EFFORT_TRIGGER = `(() => {
  const composer = document.querySelector(${COMPOSER_SELECTOR});
  if (!composer) return null;
  let scope = composer.closest("form") ?? composer.parentElement;
  for (let i = 0; i < 6 && scope?.parentElement; i++) scope = scope.parentElement;
  return [...scope.querySelectorAll('button, [role="button"]')].find(
    b => b.getAttribute("aria-expanded") !== null && (b.innerText ?? "").trim().length > 0
      && !/dictation|voice|files/i.test(b.getAttribute("aria-label") ?? "")
  ) ?? null;
})()`;

function interactiveControl(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const ownStyle = getComputedStyle(element);
  if (ownStyle.pointerEvents === 'none' || ownStyle.visibility === 'hidden') return false;
  for (let current = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    // A portaled menu overrides the body's pointer-events:none. Opacity/display,
    // unlike pointer-events, cannot be restored by a descendant.
    if (style.display === 'none' || Number(style.opacity) === 0) return false;
  }
  return true;
}

async function cleanupPointer(x,y) {
  const api=window.webContents.debugger, attachedHere=!api.isAttached();
  if(attachedHere)api.attach('1.3');
  try {
    await api.sendCommand('Page.bringToFront');
    const metrics=await api.sendCommand('Page.getLayoutMetrics');
    const zoom=metrics.cssVisualViewport?.zoom??metrics.visualViewport?.zoom??1;
    if(process.env.CODEXPP_GATEWAY_TRACE_IDS==='1')process.stdout.write(`==> codexpp cleanup pointer cdpZoom=${zoom} electronZoom=${window.webContents.getZoomFactor()}\n`);
    for(const type of ['mousePressed','mouseReleased'])await api.sendCommand('Input.dispatchMouseEvent',{type,x:x*zoom,y:y*zoom,button:'left',clickCount:1});
  } finally {if(attachedHere&&api.isAttached())api.detach();}
}

async function setEffort(index) {
  const trigger = await evaluate(EFFORT_PROBE);
  if (!trigger?.available) return { applied: false, reason: trigger?.reason ?? "unavailable" };

  const focused = await evaluate(`(() => {
    const b = ${EFFORT_TRIGGER};
    if (!b) return null;
    b.focus();
    return document.activeElement === b || b.contains(document.activeElement);
  })()`);
  if (!focused) return { applied: false, reason: "trigger focus" };

  key("Return");
  await sleep(700);

  const expanded = await evaluate(`(() => {
    const b = ${EFFORT_TRIGGER};
    return b ? b.getAttribute("aria-expanded") === "true" : false;
  })()`).catch(() => false);
  if (!expanded) return { applied: false, reason: "menu" };

  // The family list remains mounted with opacity:0/pointer-events:none while the effort
  // view is visible. Presence/rectangle alone is not proof that a choice can be selected.
  const familyView = async desired => {
    const current = await evaluate(`(() => {
      const rows=[...document.querySelectorAll('[role="menu"] [role="menuitem"][aria-expanded]')]
        .filter(${interactiveControl.toString()});
      if(rows.length!==1)return null;
      rows[0].focus();return rows[0].getAttribute('aria-expanded')==='true';
    })()`);
    if (current === null) throw new Error('ChatGPT model view control is unavailable; no prompt was sent');
    if (current !== desired) { key('Return'); await sleep(500); }
  };
  const familyProbe = `(() => {
    const rows=[...document.querySelectorAll('[role="menu"] [role="menuitemradio"]')]
      .filter(e=>/^GPT-5\\.6 Sol$/.test(e.innerText.trim())&&(${interactiveControl.toString()})(e));
    if(rows.length!==1)return null;
    rows[0].focus();return {selected:rows[0].getAttribute('aria-checked')==='true'};
  })()`;
  try {
    await familyView(true);
    const family = await waitFor(familyProbe, { timeoutMs: 3_000, intervalMs: 100, label: 'interactive GPT-5.6 Sol family' });
    if (!family.selected) {
      key('Return'); await sleep(500);
      // A family choice returns to the effort view. Reopen it and prove checked state.
      await familyView(true);
    }
    const proved = await evaluate(familyProbe);
    if (!proved?.selected) throw new Error('ChatGPT Sol selection could not be verified; no prompt was sent');
    // The view toggle itself is hidden while the family view is open. Close the
    // popup and reopen its initial effort view rather than focus a hidden toggle.
    key('Escape'); await sleep(300);
    await evaluate(`(() => {const b=${EFFORT_TRIGGER};b?.focus()})()`);
    key('Return'); await sleep(500);

    // Same contract as reference browser-worker: keyboard events belong to the menuitem
    // which owns the slider, not its presentational thumb.
    const sliderProbe = `(() => {
      const rows=[...document.querySelectorAll('[role="menu"] [role="slider"]')].filter(${interactiveControl.toString()});
      if(rows.length!==1)return null;
      const s=rows[0],owner=s.closest('[role="menuitem"]');if(!owner)return null;
      owner.focus();return {min:Number(s.getAttribute('aria-valuemin')),max:Number(s.getAttribute('aria-valuemax')),now:Number(s.getAttribute('aria-valuenow'))};
    })()`;
    let slider = await evaluate(sliderProbe);
    if (!slider) throw new Error('ChatGPT interactive effort slider is unavailable; no prompt was sent');
    const wanted = validateEffortRange(index, slider);
    const proAvailable = slider.max >= 4;
    for (let attempts = 0; slider.now !== wanted && attempts < 5; attempts++) {
      const previous = slider.now, direction = wanted > previous ? 1 : -1;
      key(direction > 0 ? 'Right' : 'Left');
      slider = await waitFor(`(() => {const s=${sliderProbe};return s&&s.now!==${previous}?s:null})()`, {
        timeoutMs: 3_000, intervalMs: 100, label: 'exact one-step effort change',
      });
      if (slider.now !== previous + direction) throw new Error('ChatGPT effort did not move exactly one step; no prompt was sent');
    }
    return { applied: slider.now === wanted, family: 'sol', proAvailable, now: slider.now, wanted };
  } finally { key('Escape'); await sleep(400); }
}

function validateEffortRange(index, slider) {
  if (!Number.isInteger(index) || !Number.isFinite(slider?.min) || !Number.isFinite(slider?.max)) {
    throw new Error("the requested ChatGPT effort or slider range is invalid");
  }
  if (index < slider.min || index > slider.max) {
    throw new Error(`ChatGPT effort ${index} is not available; the account slider range is ${slider.min}-${slider.max}`);
  }
  return index;
}

let conversation = null;

const TEMPORARY_CHAT_URL = "https://chatgpt.com/?temporary-chat=true";
const NORMAL_CHAT_URL = "https://chatgpt.com/";
const PLUGIN_NAME = CONNECTOR_NAME;

function chatHistoryMode(value = process.env.CODEXPP_WEB_CHAT_HISTORY ?? '') {
  if (value === '' || value === 'temporary') return 'temporary';
  if (value === 'normal') return 'normal';
  throw new Error('Unsupported ChatGPT history mode; explicitly choose temporary or normal');
}

// Temporary Chat connector availability depends on the account's personalization choice.
// Never infer permission to save task context in normal history from connector availability.
const PILL_SELECTOR = `[data-id^="plugin:"][data-keyword="${PLUGIN_NAME}"]`;
// `.__menu-item` also matches every sidebar row; only the mention rows carry an impression id.
const MENTION_ROW_SELECTOR = `[data-composer-plugin-impression-id]`;
const MENTION_QUERY = "@codex";
const MENTION_ATTEMPTS = 3;

async function pluginAttached() {
  return evaluate(`(() => {
    const c = document.querySelector(${COMPOSER_SELECTOR});
    const scope = c?.closest("form") ?? document;
    return scope.querySelectorAll(${JSON.stringify(PILL_SELECTOR)}).length === 1;
  })()`).catch(() => false);
}

function clearComposer() {
  key("a", [selectAllModifier()]);
  key("Backspace");
}

function beginOwnedComposer(read) {
  const element=document.querySelector('#prompt-textarea'), form=element?.closest('form');
  if(!element || !form || read(element)?.trim() || form.querySelector('[role="group"][aria-label], [data-id^="plugin:"]')) {
    throw Error('The ChatGPT composer contains an unowned draft, connector or attachment; it was preserved');
  }
  window.__codexppOwnedInsertion=null;
  window.__codexppComposerMutation={element,url:location.href,mention:'',imageNames:[],pill:null,submitted:false};
  return true;
}

function ownedRollbackPlan(read) {
  const own=window.__codexppComposerMutation, element=document.querySelector('#prompt-textarea');
  if(!own || own.submitted || own.element!==element || own.url!==location.href)return null;
  const text=read(element), insertion=window.__codexppOwnedInsertion;
  const inserted=insertion?.element===element && insertion.url===location.href && !insertion.submissionAttempted
    && !insertion.before.trim() && typeof text==='string' && (insertion.before+insertion.prompt).startsWith(text);
  if(typeof text!=='string' || (text.trim() && text!==own.mention && !inserted))return null;
  const form=element.closest('form');
  const groups=[...form.querySelectorAll('[role="group"][aria-label]')];
  const pills=[...form.querySelectorAll('[data-id^="plugin:"]')];
  const samePill=p=>p===own.pill || (own.pill?.getAttribute('data-id') && p.getAttribute('data-id')===own.pill.getAttribute('data-id')
    && p.getAttribute('data-keyword')===own.pill.getAttribute('data-keyword'));
  if(groups.some(g=>!own.imageNames.includes(g.getAttribute('aria-label'))) || pills.length>1 || pills.some(p=>!samePill(p)))return null;
  return {element,groups,pills};
}

async function clearOwnedMention() {
  await evaluate(`(()=>{const plan=(${ownedRollbackPlan.toString()})(${readComposerText.toString()});
    if(!plan||plan.groups.length||plan.pills.length)throw Error('Connector selection lost composer ownership; draft preserved');
    plan.element.focus();if(document.activeElement!==plan.element)throw Error('Composer focus unavailable');
    const range=document.createRange();range.selectNodeContents(plan.element);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    document.execCommand('delete');window.__codexppComposerMutation.mention='';return true})()`);
}

async function rollbackOwnedComposer() {
  // The physical owner is already gone. Observing its dead renderer would
  // incorrectly turn successful close/crash cleanup into a permanent lease.
  if (!window || window.isDestroyed()) return true;
  const state=await evaluate(`(()=>{const own=window.__codexppComposerMutation;return !own?'none':own.submitted?'submitted':own.imageNames.length?'upload':'unsent'})()`);
  if(state==='none'||state==='submitted')return true;
  for(let i=0;i<10;i++) {
    const next=await evaluate(`(()=>{const p=(${ownedRollbackPlan.toString()})(${readComposerText.toString()});if(!p)return {preserved:true};
      if(!p.groups.length)return {empty:true};const group=p.groups[0];
      const buttons=[...group.querySelectorAll('button')].filter(b=>/remove|kaldır|delete|sil/i.test(b.getAttribute('aria-label')??''));
      if(buttons.length!==1||buttons[0].disabled)return {preserved:true};buttons[0].focus();
      if(document.activeElement!==buttons[0])return {preserved:true};const r=buttons[0].getBoundingClientRect();return {name:group.getAttribute('aria-label'),x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    if(next.preserved)return false;
    if(next.empty)break;
    // Use the same trusted CDP pointer path as the reference browser driver;
    // Electron sendInputEvent did not remove the live owned image tile.
    await cleanupPointer(next.x,next.y);
    await waitFor(`![...document.querySelector('#prompt-textarea').closest('form').querySelectorAll('[role="group"][aria-label]')].some(g=>g.getAttribute('aria-label')===${JSON.stringify(next.name)})`,{timeoutMs:3000,label:'owned attachment rollback'});
  }
  const focused=await evaluate(`(()=>{const p=(${ownedRollbackPlan.toString()})(${readComposerText.toString()});if(!p||p.groups.length)return false;p.element.focus();return document.activeElement===p.element})()`);
  if(!focused)return false;
  // Reference clearChatGptComposerState uses the editor's native keyboard path.
  // execCommand('delete') can look empty but leave ChatGPT's persisted draft intact.
  await key('a',[selectAllModifier()]);await key('Backspace');await sleep(500);
  const empty=`(()=>{const c=document.querySelector('#prompt-textarea');return !!c&&!(${readComposerText.toString()})(c).trim()&&!c.closest('form').querySelector('[data-id^="plugin:"], [role="group"][aria-label]')})()`;
  const clean=await waitFor(empty,{timeoutMs:3000,label:'owned composer rollback'}).then(()=>true,()=>false);
  // A late upload must not reappear in the next lease after rollback. Destroy only
  // this verified, unsent, cleaned document; foreign edits keep the lease blocked.
  if(clean&&state==='upload'&&window&&!window.isDestroyed()) {
    await sleep(500);
    // Await navigation completion, not an old composer's presence while reload
    // is merely scheduled. The persisted draft must be empty in the new page.
    await window.webContents.loadURL(window.webContents.getURL());
    if(!await waitFor(empty,{timeoutMs:15000,label:'owned rollback reload'}).then(()=>true,()=>false))return false;
    window.destroy();
  }
  return clean;
}

const MENTION_ROWS = `(() => {
  const rows = [...document.querySelectorAll(${JSON.stringify(MENTION_ROW_SELECTOR)})];
  const index = rows.findIndex(r => ((r.innerText ?? "").split("\\n")[0] ?? "").trim() === ${JSON.stringify(PLUGIN_NAME)});
  return index < 0 ? null : {
    index,
    count: rows.length,
    highlighted: rows[index].querySelector("[data-highlighted]") !== null
  };
})()`;

const MENTION_DIAGNOSTIC = `(() => {
  const c = document.querySelector(${COMPOSER_SELECTOR});
  return {
    url: location.href.slice(0, 60),
    composer: Boolean(c),
    textCharacters: (c?.innerText ?? "").length,
    focus: document.hasFocus(),
    active: document.activeElement?.tagName ?? null,
    inComposer: Boolean(c && (document.activeElement === c || c.contains(document.activeElement))),
    rows: document.querySelectorAll(${JSON.stringify(MENTION_ROW_SELECTOR)}).length,
    menuItems: document.querySelectorAll('.__menu-item[tabindex="0"]').length,
    pills: document.querySelectorAll('[data-id^="plugin:"]').length
  };
})()`;

// ChatGPT's composer is a Lexical editor: the connector is chosen from the mention menu with the
// keyboard, and the pill it leaves behind is the only proof it took. Clearing the composer after
// the selection deletes that pill, so nothing may run between Enter and the check.
async function attachPlugin({ force = false } = {}) {
  // A composer draft survives a reload, pill included, so a fresh chat starts from empty rather
  // than trusting a pill whose text would end up glued to the front of the prompt.
  if (!force && await pluginAttached() === true) return { attached: true, reason: "already selected" };

  let row = null;
  let attempts = 0;
  while (attempts < MENTION_ATTEMPTS && !row) {
    attempts += 1;
    await focusComposer();
    await clearOwnedMention();
    await sleep(400);
    await evaluate(`window.__codexppComposerMutation.mention=${JSON.stringify(MENTION_QUERY)}`);
    typeCharacters(MENTION_QUERY);
    row = await waitFor(MENTION_ROWS, { timeoutMs: 4_000, intervalMs: 250, label: "the mention menu" })
      .catch(() => null);
  }

  if (!row) {
    const seen = await evaluate(MENTION_DIAGNOSTIC).catch((err) => ({ error: err.message }));
    await clearOwnedMention();
    return {
      attached: false,
      reason: `the mention menu did not offer ${PLUGIN_NAME} in ${attempts} attempts ${JSON.stringify(seen)}`
    };
  }

  const highlighted = () => evaluate(MENTION_ROWS).then(r => r?.highlighted === true).catch(() => false);
  for (let move = 0; move < row.count && (await highlighted()) !== true; move += 1) {
    key("Down");
    await sleep(160);
  }
  if ((await highlighted()) !== true) {
    await clearOwnedMention();
    return { attached: false, reason: `could not highlight ${PLUGIN_NAME} in the mention menu` };
  }

  key("Return");

  const deadline = Date.now() + 10_000;
  let attached = false;
  while (Date.now() < deadline && !attached) {
    await sleep(400);
    attached = await pluginAttached() === true;
  }
  if(attached)await evaluate(`(()=>{const own=window.__codexppComposerMutation;own.pill=own.element.closest('form').querySelector(${JSON.stringify(PILL_SELECTOR)});own.mention='';return true})()`);
  return { attached, attempts, reason: attached ? null : "the connector pill is not in the composer" };
}

function harnessPreamble({ token }) {
  if (typeof token !== "string" || !token) throw new Error("Full ChatGPT Web mode requires a current turn token");
  return [
    `<codex_transport_resume version="2">`,
    `connector=${PLUGIN_NAME}`,
    `turn_token=${token}`,
    'Every connector invocation requires a fresh request_id (8-128 letters, digits, underscores or hyphens). Reuse it only for an exact retry, never for a new call or wait poll.',
    `Use this token for every connector tool round in this logical user turn.`,
    `Call only tools returned by codex_tool_inventory; never substitute an unavailable tool.`,
    `</codex_transport_resume>`,
  ].join("\n");
}

function buildOutgoingPrompt({ reusable, tail, prompt, harness, token }) {
  const context = reusable && tail ? tail : prompt;
  if (!harness) return context;
  // web-contract normally embeds this token already. Keeping this guard here makes a retained
  // caller safe even if it supplies only a canonical suffix.
  return context.includes(token) ? context : `${harnessPreamble({ token })}\n\n${context}`;
}

async function composerPresent() {
  return evaluate(`Boolean(document.querySelector(${COMPOSER_SELECTOR}))`).catch(() => false);
}

async function openChat({ harness, effortIndex, signal }) {
  // Saved history is an explicit launch-time opt-in, never a connector-failure fallback.
  const historyMode = chatHistoryMode();
  await window.webContents.loadURL(historyMode === 'normal' ? NORMAL_CHAT_URL : TEMPORARY_CHAT_URL, { userAgent: chromeUserAgent() });
  signal?.throwIfAborted();
  await waitFor(`Boolean(document.querySelector(${COMPOSER_SELECTOR}))`, { timeoutMs: 60_000, label: "composer" });
  await sleep(700);

  {
    const temporary = await evaluate(`(() => ({
      query: new URL(location.href).searchParams.get("temporary-chat") === "true",
      visible: Boolean(document.querySelector('button[aria-label="Geçici sohbeti kapat"],button[aria-label="Close temporary chat"]'))
    }))()`);
    if (historyMode === 'temporary' && !temporary?.visible) {
      throw new Error("Temporary Chat could not be verified; Codex++ will not silently save this turn to normal history");
    }
    if (historyMode === 'normal' && (temporary?.visible || temporary?.query)) throw new Error('The explicitly requested normal ChatGPT history mode could not be verified');
  }
  signal?.throwIfAborted();
  await evaluate(`(${beginOwnedComposer.toString()})(${readComposerText.toString()})`);
  const plugin = harness ? await step("attachPlugin", () => attachPlugin({ force: true })) : null;
  if (harness && plugin?.attached !== true) {
    throw new Error(`the ${PLUGIN_NAME} connector is unavailable in this ${historyMode === 'normal' ? 'normal chat' : 'Temporary Chat'} (${plugin?.reason ?? "unknown"}); review the connector and ChatGPT's personalization choice yourself. No task was sent`);
  }

  let effort = { applied: false, reason: "not requested" };
  signal?.throwIfAborted();
  if (effortIndex !== null) {
    effort = await step("setEffort", () => setEffort(effortIndex));
    if (effort.applied !== true || effort.now !== effort.wanted) {
      await sleep(500);
      effort = await step("setEffort", () => setEffort(effortIndex));
    }
    if (effort.applied !== true || effort.now !== effortIndex) {
      throw new Error(`ChatGPT effort ${effortIndex} could not be verified before submission`);
    }
  }
  return { effort, plugin, historyMode };
}

// ProseMirror renders each input newline as a paragraph. innerText adds layout
// blank lines between paragraphs; textContent drops their separators entirely.
// Serialize the observed editor structure without changing literal whitespace.
function readComposerText(composer) {
  if (!composer) return null;
  if (typeof composer.value === "string") return composer.value;
  const read = node => {
    if (node.getAttribute?.('data-id')?.startsWith('plugin:') || node.hasAttribute?.('data-inline-selection-pill-cursor-target')) return "";
    if (node.nodeType === 3) return node.textContent ?? "";
    if (node.tagName === "BR") return node.classList?.contains("ProseMirror-trailingBreak") ? "" : "\n";
    return [...(node.childNodes ?? [])].map(read).join("");
  };
  return [...composer.childNodes].map((node, index) =>
    (index > 0 && /^(P|DIV)$/.test(node.tagName) ? "\n" : "") + read(node)).join("");
}

async function composerText() {
  return evaluate(`(${readComposerText.toString()})(document.querySelector(${COMPOSER_SELECTOR}))`).catch(() => null);
}

function promptLanded(before, after, prompt) {
  if (typeof after !== "string" || after === before) return false;
  const expected = (before ?? "") + prompt;
  if (expected.length !== after.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] === after[index]) continue;
    // Reference's narrowly scoped DOM NBSP equivalence, never trim user content.
    if (expected[index] === " " && after[index] === "\u00a0" && (expected[index - 1] === " " || expected[index + 1] === " ")) continue;
    return false;
  }
  return true;
}

function responseBelongsToSubmission(snapshot, submission) {
  if (!snapshot || !submission) return false;
  if (snapshot.url !== submission.url) {
    // Reference binds the response to its stable turn identity. Normal ChatGPT
    // assigns /c/<id> asynchronously after the first accepted message.
    let before, after;
    try { before = new URL(submission.url); after = new URL(snapshot.url); } catch { return false; }
    const provisional = /^\/c\/WEB:[a-f0-9-]{36}$/;
    const assigned = /^\/c\/[a-f0-9-]{36}$/;
    const promotion = before.pathname === '/' ? assigned.test(after.pathname) || provisional.test(after.pathname)
      : provisional.test(before.pathname) && assigned.test(after.pathname);
    if (before.origin !== 'https://chatgpt.com' || after.origin !== before.origin
      || !promotion || before.searchParams.get('temporary-chat') === 'true'
      || !submission.lastUserId || !snapshot.userIds?.includes(submission.lastUserId)) return false;
  }
  if (submission.responseId) return snapshot.id === submission.responseId;
  return Boolean(snapshot.id && snapshot.id !== submission.lastAssistantId);
}

function verifiedFinalSnapshot(snapshot) {
  return Boolean(snapshot?.text && snapshot.terminal === true && snapshot.streaming === false);
}

async function typePrompt(prompt) {
  const focus = await step("focusComposer", () => focusComposer());
  const before = await composerText();
  if (before === null) throw new Error("the ChatGPT composer disappeared before insertion");
  if (before.trim()) throw new Error("ChatGPT composer contains an existing draft; it was not overwritten or submitted");

  await window.webContents.executeJavaScript(`(() => {
    const c = document.querySelector(${COMPOSER_SELECTOR});
    if (!c) return false;
    c.focus();
    if(document.activeElement!==c)return false;
    const selection=window.getSelection();if(!selection)return false;
    const range=document.createRange();range.selectNodeContents(c);range.collapse(false);
    selection.removeAllRanges();selection.addRange(range);
    window.__codexppOwnedInsertion={element:c,before:${JSON.stringify(before)},prompt:${JSON.stringify(prompt)},url:location.href};
    return document.execCommand("insertText", false, ${JSON.stringify(prompt)});
  })()`, true).catch(() => false);
  await sleep(600);
  let after;
  const deadline = Date.now() + 10000;
  do {
    after = await composerText();
    if (promptLanded(before, after, prompt)) {
      const owned = await evaluate(`(${verifyOwnedSubmission.toString()})(${JSON.stringify(prompt)},${readComposerText.toString()},${promptLanded.toString()})`);
      if (!owned) throw new Error('Composer ownership changed during insertion; no prompt was submitted or retried');
      return { before, after };
    }
    await sleep(100);
  } while (Date.now() < deadline);
  if (after !== before) {
    const restored = await evaluate(`(${restoreOwnedInsertion.toString()})(${JSON.stringify(after)},${readComposerText.toString()})`).catch(() => false);
    throw new Error(`ChatGPT accepted only a partial prompt (${(after?.length ?? 0) - before.length}/${prompt.length} chars); the turn was not submitted or retried; ownedDraftRestored=${restored === true}`);
  }

  throw new Error(`the prompt did not reach the ChatGPT composer (focused=${focus?.focused === true}); character replay was intentionally skipped to avoid duplication`);
}

// Unlike the reference's unconditional clearChatGptComposerState, undo only our
// exact, still-current editor transaction. A remount or user edit is preserved.
function restoreOwnedInsertion(observed, read) {
  const owned = window.__codexppOwnedInsertion;
  const composer = document.querySelector('#prompt-textarea');
  if (!owned || owned.submissionAttempted || composer !== owned.element || owned.before.trim() || typeof observed !== 'string'
    || !observed.startsWith(owned.before) || !owned.prompt.startsWith(observed.slice(owned.before.length))
    || read(composer) !== observed) return false;
  composer.focus();
  document.execCommand('undo', false);
  const restored = read(composer) === owned.before;
  // A failed native editor undo still needs the original exact-prefix proof
  // for the guarded image/pill/draft cleanup in runTurn's error path.
  if (restored) delete window.__codexppOwnedInsertion;
  return restored;
}

function verifyOwnedSubmission(prompt, read, matches) {
  const owned = window.__codexppOwnedInsertion;
  const composer = document.querySelector('#prompt-textarea');
  return Boolean(owned && !owned.submissionAttempted && composer === owned.element
    && owned.url === location.href && !owned.before.trim() && owned.prompt === prompt
    && matches(owned.before, read(composer), prompt));
}

// Adapted from the MIT reference chatGptImageFilePayloads (see THIRD_PARTY_NOTICES).
// Validate the complete batch before touching the browser or writing upload files.
function prepareImageAttachments(images = []) {
  if (!Array.isArray(images)) throw new Error('image attachments must be an array');
  if (images.length > 10) throw new Error('ChatGPT accepts at most 10 image attachments per turn');
  const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  let total = 0;
  return images.map((image, index) => {
    const label = `image attachment ${index + 1}`, source = image?.source;
    if (typeof source !== 'string' || !source) throw new Error(`${label} has no supported source`);
    let buffer, file, extension, size;
    if (source.startsWith('data:')) {
      const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([\s\S]*)$/i.exec(source);
      if (!match) throw new Error(`${label} is not a base64 data URL`);
      extension = extensions[match[1].toLowerCase()];
      if (!extension) throw new Error(`${label} has an unsupported media type`);
      const encoded = match[2];
      if (encoded.length > Math.ceil(20_000_000 / 3) * 4) throw new Error(`${label} exceeds 20 MB`);
      if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error(`${label} contains invalid base64`);
      buffer = Buffer.from(encoded, 'base64');
      if (buffer.toString('base64') !== encoded) throw new Error(`${label} contains noncanonical base64`);
      size = buffer.length;
    } else {
      if (!path.isAbsolute(source) || !fs.existsSync(source)) throw new Error(`${label} must be a data URL or an existing absolute local path`);
      extension = path.extname(source).slice(1).toLowerCase();
      if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)) throw new Error(`${label} has an unsupported media extension`);
      const stat = fs.statSync(source);
      if (!stat.isFile()) throw new Error(`${label} is not a file`);
      size = stat.size; file = source;
    }
    if (size === 0) throw new Error(`${label} is empty`);
    if (size > 20_000_000) throw new Error(`${label} exceeds 20 MB`);
    total += size;
    if (total > 50_000_000) throw new Error('image attachments exceed the 50 MB per-turn limit');
    return { buffer, file, extension, size };
  });
}

async function attachImages(images) {
  const prepared = prepareImageAttachments(images);
  if (prepared.length === 0) return { count: 0, cleanup: () => {} };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codexpp-web-images-"));
  const generated = [];
  try {
    const files = prepared.map((image, index) => {
      if (image.file) return image.file;
      const file = path.join(directory, `image-${index + 1}.${image.extension}`);
      generated.push(file);
      fs.writeFileSync(file, image.buffer, { mode: 0o600 });
      return file;
    });
    const debuggerApi = window.webContents.debugger;
    await evaluate(`(()=>{const own=window.__codexppComposerMutation;if(!own||own.element!==document.querySelector('#prompt-textarea')||own.url!==location.href)throw Error('Image upload lost composer ownership');own.imageNames=${JSON.stringify(files.map(file=>path.basename(file)))};return true})()`);
    const attachedHere = !debuggerApi.isAttached();
    if (attachedHere) debuggerApi.attach("1.3");
    try {
      const document = await debuggerApi.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
      const selector = await debuggerApi.sendCommand("DOM.querySelector", { nodeId: document.root.nodeId, selector: 'input[data-testid="upload-photos-input"]' });
      if (!selector.nodeId) throw new Error("ChatGPT did not expose a file input for image attachments");
      await debuggerApi.sendCommand("DOM.setFileInputFiles", { nodeId: selector.nodeId, files });
    } finally {
      if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
    }
    const count = await waitFor(`(() => {
      const composer=document.querySelector('#prompt-textarea'), form=composer?.closest('form');
      if(!form)return 0;
      const names=${JSON.stringify(files.map(file => path.basename(file)))};
      const groups=[...form.querySelectorAll('[role="group"][aria-label]')];
      const accepted=names.every(name=>groups.some(group=>group.getAttribute('aria-label')===name&&group.getBoundingClientRect().width>0));
      const send=form.querySelector('[data-testid="send-button"]');
      return accepted&&send&&!send.disabled?names.length:0;
    })()`, { timeoutMs: 60_000, label: "all uploaded image tiles and ready send control" });
    return {
      count,
      cleanup: () => {
        for (const file of generated) { try { fs.rmSync(file, { force: true }); } catch {} }
        try { fs.rmdirSync(directory); } catch {}
      },
    };
  } catch (error) {
    for (const file of generated) { try { fs.rmSync(file, { force: true }); } catch {} }
    try { fs.rmdirSync(directory); } catch {}
    throw error;
  }
}

// Stable turn/container identities follow reference browser-worker.submissionDomState.
// Collapsed user bubbles need not render the transport text; virtualization may
// remove old sections while leaving their identity containers mounted.
function readTurnDomState() {
  const ids = (selector, attribute) => [...document.querySelectorAll(selector)].map(e => e.getAttribute(attribute));
  return {
    url: location.href,
    turnIds: [...new Set(ids('[data-turn-id-container]', 'data-turn-id-container'))],
    userIds: ids('[data-turn="user"][data-turn-id]', 'data-turn-id'),
    assistantIds: ids('[data-turn="assistant"][data-turn-id]', 'data-turn-id'),
  };
}

function acceptedSubmission(before, current) {
  for (const ids of [current.turnIds, current.userIds, current.assistantIds]) {
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('ChatGPT exposed missing or duplicate turn identity');
  }
  const known = new Set(current.turnIds);
  if ([...current.userIds, ...current.assistantIds].some(id => !known.has(id))) throw new Error('ChatGPT exposed an unbound turn identity');
  const initial = new Set(before.turnIds);
  const users = current.userIds.filter(id => !initial.has(id));
  const assistants = current.assistantIds.filter(id => !initial.has(id));
  if (users.length > 1 || assistants.length > 1) throw new Error('ChatGPT exposed competing logical turn identities');
  // Reference chatGptSubmissionEvidence accepts a new assistant turn too: an
  // optimistic user container may already be present before Send is activated.
  if (users.length !== 1 && assistants.length !== 1) return null;
  return { ...current, turnIds: before.turnIds, acceptedTurnIds: current.turnIds,
    lastUserId: users[0] ?? current.userIds.at(-1) ?? null, lastAssistantId: before.assistantIds.at(-1) ?? null, responseId: assistants[0] ?? null };
}

function readVisibleAnswer(submission) {
  const turns = [...document.querySelectorAll('[data-turn="assistant"][data-turn-id]')];
  const userIds = [...document.querySelectorAll('[data-turn="user"][data-turn-id]')].map(e => e.getAttribute('data-turn-id'));
  let candidates = turns.filter(e => submission.responseId
    ? e.getAttribute('data-turn-id') === submission.responseId
    : !submission.turnIds.includes(e.getAttribute('data-turn-id')));
  let reboundFrom = null;
  // Reference reconcileAssistantTurnBinding: only a single post-baseline node,
  // in the same accepted conversation with no competing user, proves a remount.
  if (submission.responseId && !candidates.length) {
    if (userIds.some(id => !submission.acceptedTurnIds?.includes(id))) throw new Error('ChatGPT opened another user turn while the assistant was detached');
    candidates = turns.filter(e => !submission.turnIds.includes(e.getAttribute('data-turn-id')));
    if (candidates.length && location.href !== submission.url) throw new Error('ChatGPT navigated while the assistant was detached');
    if (candidates.length === 1) reboundFrom = submission.responseId;
  }
  if (candidates.length > 1) throw new Error('ChatGPT exposed competing assistant turn identities');
  const root = candidates[0];
  const visible = e => Boolean(e?.getBoundingClientRect().width);
  const stop = [...document.querySelectorAll('[data-testid="stop-button"]')].some(visible);
  const complete = visible(root?.querySelector('[data-testid="copy-turn-action-button"]'));
  return { count: turns.length, id: root?.getAttribute('data-turn-id') ?? null, reboundFrom,
    userIds, responsePresent: Boolean(root), completionActionVisible: complete,
    upstreamError: [...(root?.querySelectorAll('[role="alert"]') ?? [])].some(visible),
    text: root ? [...root.querySelectorAll('[data-message-author-role="assistant"] .markdown')].map(e => e.innerText ?? '').join('\n\n').trim() : null,
    streaming: stop, terminal: !stop && complete, url: location.href };
}

async function readAnswer({ submission, timeoutMs, signal, onDelta, token, getToolBaseline }) {
  const deadline = Date.now() + timeoutMs;
  let text = null;
  let emitted = "";
  let lastSignature = null;
  let stableSince = null;
  let lastSnapshot = null;
  let completed = false;
  let lastProgressAt = Date.now();
  let observationFaults = 0;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason ?? new Error("the ChatGPT turn was cancelled");
    await observe(sleep(1500), { signal });
    signal?.throwIfAborted();
    if (Date.now() >= deadline) break;
    let snapshot;
    try {
      snapshot = await observe(evaluate(`(${readVisibleAnswer.toString()})(${JSON.stringify(submission)})`), { signal, timeoutMs: Math.min(10_000, deadline - Date.now()) });
      observationFaults = 0;
    } catch (error) {
      signal?.throwIfAborted();
      // Reference MAX_CHATGPT_INTERNAL_OBSERVATION_FAULTS: retry observation
      // only, never Send or a tool. A successful probe resets this bounded run.
      if (error.code !== 'DOM_OBSERVATION_TIMEOUT' || ++observationFaults >= 8) throw error;
      stableSince = null;
      continue;
    }
    signal?.throwIfAborted();
    if (!snapshot) continue;
    lastSnapshot = snapshot;
    if (snapshot.reboundFrom === submission.responseId && snapshot.url === submission.url) submission.responseId = snapshot.id;
    const isNewResponse = responseBelongsToSubmission(snapshot, submission);
    if (snapshot.url !== submission.url && !isNewResponse) throw new Error("ChatGPT navigated away during the active logical turn");
    if (isNewResponse) submission.url = snapshot.url;
    if (isNewResponse && snapshot.upstreamError) throw new Error('ChatGPT displayed an error inside the bound response; no final answer was accepted');
    if (!snapshot.text || !isNewResponse) { stableSince = null; continue; }
    submission.responseId ??= snapshot.id;

    text = snapshot.text;
    if (typeof onDelta === "function" && text.startsWith(emitted) && text.length > emitted.length) {
      onDelta(text.slice(emitted.length));
      emitted = text;
    }
    const broker = token ? require("./turn-broker.cjs") : null;
    const revision = broker ? broker.beginCompletionFence(token) : 0;
    const signature = JSON.stringify([text, revision, snapshot.id]);
    if (signature !== lastSignature) lastProgressAt = Date.now();
    if (getToolBaseline?.() === text) { stableSince = null; lastSignature = signature; continue; }
    if (signature === lastSignature && revision !== undefined && verifiedFinalSnapshot(snapshot)) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince > 4000 && (!broker || broker.commitCompletionFence(token, revision))) { completed = true; break; }
    } else {
      stableSince = null;
      lastSignature = signature;
    }
  }

  if (!completed) {
    const partial = text ? `; partialChars=${text.length}` : "";
    throw new Error(`ChatGPT did not produce a verified final answer before the timeout${partial}; responsePresent=${lastSnapshot?.responsePresent ?? "unknown"}; streaming=${lastSnapshot?.streaming ?? "unknown"}; copy=${lastSnapshot?.completionActionVisible ?? "unknown"}; terminal=${lastSnapshot?.terminal ?? "unknown"}; lastProgressAgeMs=${Date.now() - lastProgressAt}`);
  }
  return text;
}

async function submissionSnapshot() {
  return evaluate(`(${readTurnDomState.toString()})()`);
}

async function submitPrompt(before, prompt) {
  // Reference browser-worker.sendAttachedPrompt focuses the owning form's button
  // and presses Enter. Acceptance below, never the key event, proves submission.
  const focused = await evaluate(`(() => {
    if(!(${verifyOwnedSubmission.toString()})(${JSON.stringify(prompt)},${readComposerText.toString()},${promptLanded.toString()}))throw Error('Composer ownership changed or submission already attempted; no Send was replayed');
    if(window.__codexppComposerMutation){const plan=(${ownedRollbackPlan.toString()})(${readComposerText.toString()});
      if(!plan||plan.groups.length!==window.__codexppComposerMutation.imageNames.length)throw Error('Attachment or connector ownership changed before Send');}
    const composer=document.querySelector('#prompt-textarea');
    const button=composer?.closest('form')?.querySelector('[data-testid="send-button"]');
    if(!button||button.disabled||!button.getBoundingClientRect().width)return false;
    button.focus();
    if(document.activeElement!==button)return false;
    window.__codexppOwnedInsertion.submissionAttempted=true;
    if(window.__codexppComposerMutation)window.__codexppComposerMutation.submitted=true;
    return true;
  })()`);
  if (!focused) throw new Error("ChatGPT send button is unavailable or could not be focused; no submission was attempted");
  key("Return");
  return waitFor(`(${acceptedSubmission.toString()})(${JSON.stringify(before)},(${readTurnDomState.toString()})())`,
    { timeoutMs: 15_000, intervalMs: 300, label: "logical user-turn submission evidence" });
}

async function stopGeneration() {
  if (!window || window.isDestroyed()) return;
  // Reference browser-worker uses stop.press("Enter"). The native Cancel button
  // owns OS focus here; a pointer event into the background browser can miss.
  const state = await evaluate(`(() => {
    const button=[...document.querySelectorAll('[data-testid="stop-button"]')].find(e=>{
      const r=e.getBoundingClientRect();return r.width>0&&r.height>0;
    });
    if(!button)return 'stopped';
    if(button.disabled)throw Error('ChatGPT stop control is disabled');
    button.focus();
    if(document.activeElement!==button)throw Error('ChatGPT stop control could not be focused');
    return 'focused';
  })()`);
  if (state === 'stopped') return;
  if (state !== 'focused') throw new Error('ChatGPT cancellation state could not be verified');
  key('Return');
  await waitFor(`![...document.querySelectorAll('[data-testid="stop-button"]')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0})`, {
    timeoutMs: 10_000,
    intervalMs: 250,
    label: "browser cancellation settlement",
  });
}

async function turn({ key: conversationKey, prompt, tail, images, effortIndex, harness, token, timeoutMs, signal, onDelta, request, compaction }) {
  signal?.throwIfAborted();
  open({ show: true });

  const contract = require("./web-contract.cjs");
  const suffix = request ? contract.canonicalSuffix(conversation?.checkpoint, contract.normalizeInput(request).records)
    : compaction ? contract.canonicalSuffix(conversation?.checkpoint, compaction.records) : null;
  const nativeConnector = harness || Boolean(compaction);
  const reusable = conversationKey != null
    && conversation?.key === conversationKey
    && conversation.effortIndex === effortIndex
    && conversation.harness === nativeConnector
    && conversation.historyMode === chatHistoryMode()
    && (!request || suffix !== null)
    && (!compaction || suffix?.length === 0)
    && (!conversation.url || window.webContents.getURL() === conversation.url)
    && await composerPresent();
  if (process.env.CODEXPP_GATEWAY_TRACE_IDS === '1') {
    process.stdout.write(`==> codexpp web continuity reused=${Boolean(reusable)} key=${conversation?.key === conversationKey} prefix=${suffix !== null} url=${!conversation?.url || window.webContents.getURL() === conversation.url}\n`);
  }

  let effort = conversation?.effort ?? { applied: false, reason: "not requested" };
  if (!reusable) {
    const existingDraft = await composerText();
    if (typeof existingDraft === 'string' && existingDraft.trim()) {
      throw new Error('ChatGPT contains an existing or unverified draft; it was preserved. Clear the owned draft explicitly before starting another conversation');
    }
    conversation = null;
    const opened = await openChat({ harness: nativeConnector, effortIndex, signal });
    effort = opened.effort;
    conversation = { key: conversationKey, effortIndex, harness: nativeConnector, effort, plugin: opened.plugin, historyMode: opened.historyMode };
  } else {
    await evaluate(`(${beginOwnedComposer.toString()})(${readComposerText.toString()})`);
    // Reference chatGptConnectorAttachmentMode/attachPrompt: the exact retained
    // lease already owns this connector. Its composer pill is consumed on Send;
    // trying @mention again may not offer the already-bound connector at all.
    if (nativeConnector && conversation.plugin?.attached !== true) throw new Error('Retained ChatGPT connector binding is missing; no prompt was submitted');
    // Account/model state can change while a retained chat remains open. Prove the requested slider
    // value again before every logical turn rather than trusting the prior selection.
    if (effortIndex !== null) {
      effort = await step("setEffort", () => setEffort(effortIndex));
      if (effort.applied !== true || effort.now !== effortIndex) {
        throw new Error(`ChatGPT could not prove requested effort ${effortIndex} before submission`);
      }
      conversation.effort = effort;
    }
  }

  signal?.throwIfAborted();
  if (request) {
    const compiled = contract.compilePrompt(request, { token, harness, retained: reusable, checkpoint: conversation.checkpoint, proAvailable: effort.proAvailable === true });
    if (reusable) tail = compiled.text; else prompt = compiled.text;
    images = compiled.images;
  }
  const outgoing = compaction ? [reusable ? '' : prompt, compaction.instruction].filter(Boolean).join('\n\n')
    : buildOutgoingPrompt({ reusable, tail, prompt, harness, token });
  if (compaction) {
    if (reusable) images = [];
    contract.promptBudget(outgoing, { effortIndex: effortIndex ?? 2, proAvailable: effort.proAvailable === true, images });
  }
  const submissionBefore = await step('submissionSnapshot', () => submissionSnapshot());
  const attached = await step('attachImages', () => attachImages(images));
  const toolBroker = harness && token ? require('./turn-broker.cjs') : null;
  let toolBaseline, acceptSubmission, rejectSubmission;
  const submissionReady = new Promise((resolve, reject) => { acceptSubmission = resolve; rejectSubmission = reject; });
  submissionReady.catch(() => {});
  toolBroker?.setToolBoundaryObserver(token, async () => {
    const bound = await observe(submissionReady, { signal, label: 'tool submission binding' });
    const snapshot = await observe(evaluate(`(${readVisibleAnswer.toString()})(${JSON.stringify(bound)})`), { signal, label: 'pre-tool answer observation' });
    signal?.throwIfAborted();
    if (snapshot?.reboundFrom === bound.responseId && snapshot.url === bound.url) bound.responseId = snapshot.id;
    if (!responseBelongsToSubmission(snapshot, bound)) throw new Error('Pre-tool response identity could not be proved');
    bound.responseId ??= snapshot.id;
    bound.url = snapshot.url;
    toolBaseline = snapshot.text ?? '';
  });
  try {
    signal?.throwIfAborted();
    await step('typePrompt', () => typePrompt(outgoing));
    signal?.throwIfAborted();
    const submission = await step('submitPrompt', () => submitPrompt(submissionBefore, outgoing));
    acceptSubmission(submission);
    conversation.url = submission.url;
    if (compaction) {
      const readerAbort = new AbortController();
      const readerSignal = signal ? AbortSignal.any([signal, readerAbort.signal]) : readerAbort.signal;
      const reading = step('checkpointReadAnswer', () => readAnswer({ submission, timeoutMs, signal: readerSignal }));
      try {
        const text = await Promise.race([compaction.promise, reading.then(() => {
          throw new Error('Structured checkpoint handoff missing; ordinary assistant text is not compaction');
        })]);
        // The reserved control delivery is terminal for this one-purpose message.
        // Never advance the epoch while the old browser still owns generation.
        await stopGeneration();
        conversation = null;
        return { text, checkpoint: true, effort, reused: reusable, chars: outgoing.length };
      } finally {
        readerAbort.abort(new Error('Checkpoint observation ended'));
        await reading.catch(() => {});
      }
    }
    const text = await step('readAnswer', () => readAnswer({ submission, timeoutMs, signal, onDelta, token: harness ? token : null, getToolBaseline: () => toolBaseline }));
    conversation.url = submission.url;
    return { text, effort, reused: reusable, chars: outgoing.length, plugin: conversation?.plugin ?? null };
  } finally {
    rejectSubmission(new Error('The owned browser submission ended'));
    toolBroker?.setToolBoundaryObserver(token, null);
    attached.cleanup();
  }
}

function cancellationError(reason) {
  return reason instanceof Error ? reason : new Error(String(reason ?? "the ChatGPT turn was cancelled"));
}

function runTurn({ key: conversationKey = null, prompt, tail = null, images = [], effortIndex = null, harness = false, token = null, timeoutMs = 600_000, signal = null, onDelta = null, request = null, identity = null, compaction = null } = {}) {
  if (!prompt || typeof prompt !== "string") throw new Error("runTurn needs a prompt");
  if (activeLease) {
    const recovery = activeLease.drainFailed ? '; browser cleanup failed; close the owned ChatGPT window before retrying' : '';
    throw new Error(`ChatGPT Web browser capacity is occupied by another active lease (${activeLease.id}); the threads were not mixed${recovery}`);
  }
  const controller = new AbortController();
  const lease = {
    id: `lease-${++leaseGeneration}`,
    key: conversationKey,
    controller,
    settled: false,
    // Compaction already has a tool-free compiled prompt. Carry cancellation
    // ownership independently; passing request would compile ordinary work again.
    identity: request ? require('./web-contract.cjs').parseTurnIdentity(request) : identity,
  };
  activeLease = lease;
  const forwardAbort = () => controller.abort(cancellationError(signal.reason));
  if (signal) {
    if (signal.aborted) forwardAbort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }
  const settlement = (async () => {
    try {
      return await turn({
        key: conversationKey,
        prompt,
        tail,
        images,
        effortIndex,
        harness,
        token,
        timeoutMs,
        signal: controller.signal,
        onDelta,
        request,
        compaction,
      });
    } catch (error) {
      // Failures after submission own the same physical cleanup as cancellation.
      // Releasing the lease first would leave an old generation calling revoked tools.
      conversation = null;
      try { await stopGeneration(); }
      catch { lease.drainFailed = true; }
      try { if(!await rollbackOwnedComposer())lease.drainFailed=true; }
      catch { lease.drainFailed=true; }
      throw error;
    } finally {
      if (signal) signal.removeEventListener?.("abort", forwardAbort);
      lease.settled = true;
      if (activeLease === lease && !lease.drainFailed) activeLease = null;
    }
  })();
  let abortListener;
  const cancelled = new Promise((_, reject) => {
    abortListener = () => reject(cancellationError(controller.signal.reason));
    if (controller.signal.aborted) abortListener();
    else controller.signal.addEventListener('abort', abortListener, { once: true });
  });
  const run = Promise.race([settlement, cancelled]);
  run.settlement = settlement.catch(() => {}).finally(() => controller.signal.removeEventListener('abort', abortListener));
  run.leaseId = lease.id;
  run.cancel = (reason) => controller.abort(cancellationError(reason));
  return run;
}

function cancelTurn(leaseId, reason) {
  if (!activeLease || (leaseId && activeLease.id !== leaseId)) return false;
  activeLease.controller.abort(cancellationError(reason));
  return true;
}

function resetConversation() {
  conversation = null;
}

function close() {
  if (activeLease) activeLease.controller.abort(new Error("the ChatGPT browser window was closed"));
  if (window && !window.isDestroyed()) window.destroy();
  if (activeLease?.drainFailed) activeLease = null;
  window = null;
  conversation = null;
}

function commitContext(key, request, output, { stripCompactionTrigger = false } = {}) {
  if (!conversation || conversation.key !== key) return false;
  conversation.checkpoint = require("./web-contract.cjs").contextCheckpoint(request, output);
  if (stripCompactionTrigger) conversation.checkpoint = conversation.checkpoint.filter(item => item.type !== 'compaction_trigger');
  return true;
}

return {
  open,
  close,
  status,
  effortTrigger,
  setEffort,
  validateEffortRange,
  chatHistoryMode,
  selectAllModifier,
  inputPoint,
  promptLanded,
  restoreOwnedInsertion,
  beginOwnedComposer,
  ownedRollbackPlan,
  rollbackOwnedComposer,
  verifyOwnedSubmission,
  readComposerText,
  prepareImageAttachments,
  responseBelongsToSubmission,
  verifiedFinalSnapshot,
  acceptedSubmission,
  readTurnDomState,
  readVisibleAnswer,
  observe,
  harnessPreamble,
  buildOutgoingPrompt,
  runTurn,
  cancelTurn,
  cancelThread: (threadId, turnId) => activeLease?.identity?.threadId === threadId && activeLease?.identity?.turnId === turnId
    ? cancelTurn(activeLease.id, 'the user cancelled the native turn') : false,
  resetConversation,
  commitContext,
  PARTITION,
  leaseStatus: () => ({ active: Boolean(activeLease), drainFailed: activeLease?.drainFailed === true }),
};
}
module.exports = { ...require('./web-browser-pool.cjs').createPool(createSession), createSession };
