const PARTITION = "persist:codexpp-chatgpt";
const HOME_URL = "https://chatgpt.com/";

let window = null;

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
  window.on("closed", () => { window = null; });
  window.webContents.setUserAgent(userAgent);
  window.loadURL(HOME_URL, { userAgent });
  return window;
}

async function evaluate(expression) {
  if (!window || window.isDestroyed()) throw new Error("the ChatGPT window is not open");
  return window.webContents.executeJavaScript(expression, true);
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

// `webContents.insertText` and the edit commands are no-ops while the window lacks OS focus, and a
// harness turn runs behind whatever the user is doing. Synthesised input events do not need it.
function typeCharacters(text) {
  for (const character of text) {
    window.webContents.sendInputEvent({ type: "char", keyCode: character });
  }
}

function mouse(x, y) {
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

  const slider = await evaluate(`(() => {
    const s = document.querySelector('[role="slider"]');
    if (!s) return null;
    s.focus();
    return { min: Number(s.getAttribute("aria-valuemin")), max: Number(s.getAttribute("aria-valuemax")), now: Number(s.getAttribute("aria-valuenow")) };
  })()`);
  if (!slider) {
    key("Escape");
    return { applied: false, reason: "slider" };
  }

  const wanted = Math.min(Math.max(index, slider.min), slider.max);
  const steps = slider.max - slider.min;
  for (let i = 0; i <= steps; i++) { key("Left"); await sleep(160); }
  for (let i = 0; i < wanted - slider.min; i++) { key("Right"); await sleep(160); }
  await sleep(300);

  const landed = await evaluate(`(() => {
    const s = document.querySelector('[role="slider"]');
    const scope = s?.closest('[role="menu"],[data-radix-popper-content-wrapper]') ?? s?.parentElement;
    const label = (scope?.innerText ?? "").split("\\n").map(x => x.trim()).filter(Boolean)[0] ?? null;
    return s ? { now: Number(s.getAttribute("aria-valuenow")), label } : null;
  })()`);

  key("Escape");
  await sleep(400);
  return { applied: landed?.now === wanted, now: landed?.now ?? null, label: landed?.label ?? null, wanted };
}

let conversation = null;
let queue = Promise.resolve();

const TEMPORARY_CHAT_URL = "https://chatgpt.com/?temporary-chat=true";
const NORMAL_CHAT_URL = "https://chatgpt.com/";
const PLUGIN_NAME = "Codex Native2";

// Temporary Chat ignores plugins, so a harness turn runs in a normal chat with the connector
// selected from the composer's mention menu.
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
  key("a", ["cmd"]);
  key("Backspace");
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
    text: (c?.innerText ?? "").slice(0, 40),
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
    clearComposer();
    await sleep(400);
    typeCharacters(MENTION_QUERY);
    row = await waitFor(MENTION_ROWS, { timeoutMs: 4_000, intervalMs: 250, label: "the mention menu" })
      .catch(() => null);
  }

  if (!row) {
    const seen = await evaluate(MENTION_DIAGNOSTIC).catch((err) => ({ error: err.message }));
    clearComposer();
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
    clearComposer();
    return { attached: false, reason: `could not highlight ${PLUGIN_NAME} in the mention menu` };
  }

  key("Return");

  const deadline = Date.now() + 10_000;
  let attached = false;
  while (Date.now() < deadline && !attached) {
    await sleep(400);
    attached = await pluginAttached() === true;
  }
  return { attached, attempts, reason: attached ? null : "the connector pill is not in the composer" };
}

function harnessPreamble({ token }) {
  return [
    `You are the engine behind a Codex task running on the user's machine. Their working folder and`,
    `files are reachable only through the ${PLUGIN_NAME} plugin.`,
    ``,
    `Before answering, call the plugin's \`codex_exec\` tool with turn_token "${token}" and a shell`,
    `command, for example {"turn_token":"${token}","cmd":"cat secret.txt"}. The command already runs`,
    `in the Codex task's working directory, so plain relative paths work.`,
    ``,
    `Do not ask which repository or branch to use, do not ask for permission, and never guess file`,
    `contents. Read or run whatever you need through codex_exec, then answer from what it returned.`,
    ``,
    `Answer in the language the user wrote in.`
  ].join("\n");
}

async function composerPresent() {
  return evaluate(`Boolean(document.querySelector(${COMPOSER_SELECTOR}))`).catch(() => false);
}

async function assistantCount() {
  return evaluate(`document.querySelectorAll('[data-message-author-role="assistant"]').length`).catch(() => 0);
}

async function openChat({ harness, effortIndex }) {
  await window.webContents.loadURL(harness ? NORMAL_CHAT_URL : TEMPORARY_CHAT_URL, { userAgent: chromeUserAgent() });
  await waitFor(`Boolean(document.querySelector(${COMPOSER_SELECTOR}))`, { timeoutMs: 60_000, label: "composer" });
  await sleep(700);

  const plugin = harness ? await step("attachPlugin", () => attachPlugin({ force: true })) : null;
  if (harness && plugin?.attached !== true) {
    throw new Error(`the ${PLUGIN_NAME} plugin could not be attached (${plugin?.reason ?? "unknown"})`);
  }

  let effort = { applied: false, reason: "not requested" };
  if (effortIndex !== null) {
    effort = await step("setEffort", () => setEffort(effortIndex));
    if (effort.applied !== true || effort.now !== effort.wanted) {
      await sleep(500);
      effort = await step("setEffort", () => setEffort(effortIndex));
    }
  }
  return { effort, plugin };
}

async function typePrompt(prompt) {
  // The connector pill puts its own text in the composer, so only growth proves the prompt landed.
  const length = async () => evaluate(`(() => {
    const c = document.querySelector(${COMPOSER_SELECTOR});
    return (c?.innerText ?? c?.value ?? "").trim().length;
  })()`).catch(() => 0);

  const before = await length();
  const focus = await step("focusComposer", () => focusComposer());
  const landed = async () => (await length()) > before;

  window.webContents.insertText(prompt);
  await sleep(600);
  if (await landed()) return;

  await window.webContents.executeJavaScript(`(() => {
    const c = document.querySelector(${COMPOSER_SELECTOR});
    if (!c) return false;
    c.focus();
    return document.execCommand("insertText", false, ${JSON.stringify(prompt)});
  })()`, true).catch(() => false);
  await sleep(600);
  if (await landed()) return;

  typeCharacters(prompt);
  await sleep(800);
  if (await landed()) return;

  throw new Error(`the prompt did not reach the ChatGPT composer (focused=${focus?.focused === true})`);
}

async function readAnswer({ since, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let text = null;
  let lastLength = -1;
  let stableSince = null;
  let lastSnapshot = null;

  while (Date.now() < deadline) {
    await sleep(1500);
    const snapshot = await evaluate(`(() => {
      const turns = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      const last = turns.at(-1);
      const body = last?.querySelector(".markdown") ?? last;
      const stop = document.querySelectorAll('[data-testid="stop-button"], button[aria-label*="Stop"]').length > 0;
      const send = document.querySelectorAll('[data-testid="send-button"]').length > 0;
      return {
        count: turns.length,
        text: body ? (body.innerText ?? "").trim() : null,
        streaming: stop || !send
      };
    })()`).catch(() => null);
    if (!snapshot) continue;
    lastSnapshot = snapshot;
    if (!snapshot.text || snapshot.count <= since) continue;
    // "Pro thinking" and friends are status rows, not the answer.
    if (/^(pro\s+)?(thinking|reasoning|working|analyzing)\b/i.test(snapshot.text)) continue;

    text = snapshot.text;
    if (text.length === lastLength && !snapshot.streaming) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince > 4000) break;
    } else {
      stableSince = null;
      lastLength = text.length;
    }
  }

  if (!text) {
    throw new Error(`ChatGPT did not produce an answer before the timeout (last=${JSON.stringify(lastSnapshot)})`);
  }
  return text;
}

async function turn({ key: conversationKey, prompt, tail, effortIndex, harness, token, timeoutMs }) {
  open({ show: true });

  const reusable = conversationKey != null
    && conversation?.key === conversationKey
    && conversation.effortIndex === effortIndex
    && conversation.harness === harness
    && await composerPresent();

  let effort = conversation?.effort ?? { applied: false, reason: "not requested" };
  if (!reusable) {
    conversation = null;
    const opened = await openChat({ harness, effortIndex });
    effort = opened.effort;
    conversation = { key: conversationKey, effortIndex, harness, effort, plugin: opened.plugin };
  } else if (harness && (await pluginAttached()) !== true) {
    const plugin = await step("attachPlugin", () => attachPlugin());
    if (plugin.attached !== true) {
      throw new Error(`the ${PLUGIN_NAME} plugin could not be re-attached (${plugin.reason ?? "unknown"})`);
    }
    conversation.plugin = plugin;
  }

  const outgoing = reusable && tail
    ? tail
    : (harness ? `${harnessPreamble({ token })}\n\n${prompt}` : prompt);
  const since = await assistantCount();
  await typePrompt(outgoing);
  key("Return");
  const text = await readAnswer({ since, timeoutMs });
  return { text, effort, reused: reusable, chars: outgoing.length, plugin: conversation?.plugin ?? null };
}

async function runTurn({ key: conversationKey = null, prompt, tail = null, effortIndex = null, harness = false, token = null, timeoutMs = 600_000 } = {}) {
  if (!prompt || typeof prompt !== "string") throw new Error("runTurn needs a prompt");
  const run = queue.then(() => turn({ key: conversationKey, prompt, tail, effortIndex, harness, token, timeoutMs }));
  queue = run.catch(() => {});
  return run;
}

function resetConversation() {
  conversation = null;
}

function close() {
  if (window && !window.isDestroyed()) window.destroy();
  window = null;
  conversation = null;
}

module.exports = { open, close, status, effortTrigger, setEffort, runTurn, resetConversation, PARTITION };
