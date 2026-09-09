const crypto = require("node:crypto");

const TOOL_TIMEOUT_MS = 300_000;

const byToken = new Map();
const byKey = new Map();

function newTurn(key) {
  return {
    key,
    token: `cxp_${crypto.randomBytes(24).toString("hex")}`,
    queue: [],
    pending: new Map(),
    wake: null,
    browser: null,
    closed: false
  };
}

function begin(key) {
  const existing = byKey.get(key);
  if (existing && !existing.closed) return existing;
  const turn = newTurn(key);
  byKey.set(key, turn);
  byToken.set(turn.token, turn);
  return turn;
}

function attach(key, browser) {
  const turn = get(key);
  if (turn) turn.browser = browser;
  return turn;
}

function get(key) {
  const turn = byKey.get(key);
  return turn && !turn.closed ? turn : null;
}

// Called from the MCP server: hands one code-mode script to whichever gateway request is waiting,
// and resolves once Codex has run it.
function requestTool(token, source, { timeoutMs = TOOL_TIMEOUT_MS } = {}) {
  const turn = byToken.get(token);
  if (!turn || turn.closed) return Promise.reject(new Error("no active Codex turn for this token"));

  const callId = `call_${crypto.randomBytes(16).toString("hex")}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      turn.pending.delete(callId);
      reject(new Error("the Codex turn did not return a tool result in time"));
    }, timeoutMs);

    turn.pending.set(callId, {
      resolve: (text) => { clearTimeout(timer); resolve(text); },
      reject: (err) => { clearTimeout(timer); reject(err); }
    });
    turn.queue.push({ callId, source });

    const wake = turn.wake;
    turn.wake = null;
    if (wake) wake();
  });
}

// Called from the gateway: resolves as soon as ChatGPT asks for a tool, or when `race` settles.
async function waitForTool(key, race) {
  const turn = get(key);
  if (!turn) return race;

  while (true) {
    if (turn.queue.length) return { tool: turn.queue.shift() };
    const woken = new Promise((resolve) => { turn.wake = () => resolve("woken"); });
    const winner = await Promise.race([race.then((value) => ({ done: value })), woken]);
    if (winner !== "woken") return winner;
  }
}

function deliverOutput(key, callId, text) {
  const turn = get(key);
  const waiter = turn?.pending.get(callId);
  if (!waiter) return false;
  turn.pending.delete(callId);
  waiter.resolve(text);
  return true;
}

function end(key, reason) {
  const turn = byKey.get(key);
  if (!turn) return;
  turn.closed = true;
  byKey.delete(key);
  byToken.delete(turn.token);
  for (const waiter of turn.pending.values()) waiter.reject(new Error(reason ?? "the Codex turn ended"));
  turn.pending.clear();
  turn.queue.length = 0;
  const wake = turn.wake;
  turn.wake = null;
  if (wake) wake();
}

module.exports = { begin, get, attach, requestTool, waitForTool, deliverOutput, end };
