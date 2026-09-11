const crypto = require("node:crypto");

const TOOL_TIMEOUT_MS = 85_000; // Always below the 90-second MCP/tunnel invocation ceiling.
const MAX_TOMBSTONES = 2_000;

const byToken = new Map();
const byKey = new Map();
const callTombstones = new Map();
const turnTombstones = new Map();
const tokenTombstones = new Set();

function randomId(prefix, bytes = 16) {
  return `${prefix}_${crypto.randomBytes(bytes).toString("hex")}`;
}

function boundedSet(map, key, value) {
  map.set(key, value);
  while (map.size > MAX_TOMBSTONES) map.delete(map.keys().next().value);
}

function rememberToken(token) {
  tokenTombstones.add(token);
  while (tokenTombstones.size > MAX_TOMBSTONES) tokenTombstones.delete(tokenTombstones.values().next().value);
}

function closedError(reason = "the Codex turn ended") {
  const error = new Error(reason);
  error.code = "TURN_CLOSED";
  return error;
}

function newTurn(key, options = {}) {
  return {
    key,
    threadId: options.threadId ?? null,
    turnId: options.turnId ?? null,
    epoch: options.epoch ?? "0",
    registry: Array.isArray(options.registry) ? structuredClone(options.registry) : [],
    token: `cxp_${crypto.randomBytes(24).toString("hex")}`,
    state: "active",
    queue: [],
    calls: new Map(),
    activityRevision: 0,
    completionCommitted: false,
    completed: new Map(),
    waiters: new Set(),
    rounds: new Map(),
    progress: [],
    progressCursor: 0,
    progressListeners: new Set(),
    activeRound: null,
    browser: null,
    cancelBrowser: null,
    closed: false,
    closeReason: null,
    createdAt: Date.now(),
  };
}

function begin(key, options = {}) {
  if (typeof key !== "string" || !key) throw new Error("turn broker needs a non-empty key");
  const existing = byKey.get(key);
  const differentLogicalTurn = options.turnId && existing?.turnId && options.turnId !== existing.turnId;
  if (existing && !existing.closed && options.replace !== true && !differentLogicalTurn) return existing;
  if (existing && !existing.closed) end(key, "superseded by a new logical user turn");
  const turn = newTurn(key, options);
  byKey.set(key, turn);
  byToken.set(turn.token, turn);
  return turn;
}

function get(key) {
  const turn = byKey.get(key);
  return turn && !turn.closed ? turn : null;
}

function status(key) {
  const active = get(key);
  if (active) return { state: "active", turnId: active.turnId, epoch: active.epoch };
  const closed = turnTombstones.get(key);
  return closed ? { ...closed } : { state: "unknown" };
}

function attach(key, browser, { cancel } = {}) {
  const turn = get(key);
  if (!turn) return null;
  turn.browser = Promise.resolve(browser);
  turn.physicalSettlement = browser.settlement ?? turn.browser;
  turn.cancelBrowser = typeof cancel === "function" ? cancel : null;
  return turn;
}

function publishProgress(key, delta, phase = "commentary") {
  const turn = get(key);
  if (!turn || typeof delta !== "string" || !delta) return false;
  const event = { sequence: turn.progress.length + 1, delta, phase };
  turn.progress.push(event);
  for (const listener of turn.progressListeners) {
    try { listener(event); } catch {}
  }
  return true;
}

function subscribeProgress(key, listener) {
  const turn = get(key);
  if (!turn || typeof listener !== "function") return () => {};
  const deliver = (event) => {
    if (event.sequence <= turn.progressCursor) return;
    listener(event);
    turn.progressCursor = event.sequence;
  };
  for (const event of turn.progress) deliver(event);
  turn.progressListeners.add(deliver);
  return () => turn.progressListeners.delete(deliver);
}

function wakeAll(turn) {
  const waiters = [...turn.waiters];
  turn.waiters.clear();
  for (const waiter of waiters) waiter.resolve();
}

function removeQueued(turn, callId) {
  const index = turn.queue.findIndex((entry) => entry.callId === callId);
  if (index !== -1) turn.queue.splice(index, 1);
}

function sameRequest(left, right) {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function setToolBoundaryObserver(token, observer) {
  const turn = byToken.get(token);
  if (!turn || turn.closed) return false;
  turn.toolBoundaryObserver = typeof observer === 'function' ? observer : null;
  return true;
}

// A retry with the exact same call id shares the original invocation; it never queues the native
// side effect twice.
function requestTool(token, request, { timeoutMs = TOOL_TIMEOUT_MS } = {}) {
  const checkpoint = require('./web-compaction.cjs');
  if (request?.bridgeArguments?.wire_name === checkpoint.WIRE_NAME) {
    try { return Promise.resolve(checkpoint.submit(token, request)); }
    catch (error) { return Promise.reject(error); }
  }
  const turn = byToken.get(token);
  if (!turn || turn.closed) {
    const reason = tokenTombstones.has(token) ? "the Codex turn token was revoked" : "no active Codex turn for this token";
    return Promise.reject(new Error(reason));
  }
  if (turn.completionCommitted) return Promise.reject(new Error("browser completion is committed; this turn no longer accepts tools"));
  let normalized = typeof request === "string"
    ? { callId: randomId("call"), wireName: "exec", kind: "freeform", input: request }
    : { ...request };
  const callId = typeof normalized.callId === "string" && normalized.callId ? normalized.callId : randomId("call");
  normalized.callId = callId;

  if (normalized.bridgeArguments) {
    try {
      const native = require("./native-tools.cjs");
      native.validateArguments(normalized.bridgeTool, normalized.bridgeArguments);
      const resolved = native.resolveNativeRequest(turn.registry, normalized.bridgeTool, normalized.bridgeArguments);
      if (resolved.result) return Promise.resolve(resolved.result);
      normalized = { ...resolved, callId, bridgeTool: normalized.bridgeTool };
    } catch (error) { return Promise.reject(error); }
  }

  const prior = turn.calls.get(callId);
  if (prior) {
    if (!sameRequest(prior.request, normalized)) {
      return Promise.reject(new Error(`callId ${callId} was already used with a different request`));
    }
    if (prior.state === "resolved") return Promise.resolve(prior.transportResult ?? prior.result);
    if (["queued", "dispatched"].includes(prior.state)) return prior.promise;
    return Promise.reject(new Error(`callId ${callId} is ${prior.state}; its side effect will not be retried`));
  }
  const tombstone = callTombstones.get(callId);
  if (tombstone) return Promise.reject(new Error(`callId ${callId} is stale (${tombstone.state})`));

  if (turn.compactionResult) {
    const result = structuredClone(turn.compactionResult);
    turn.calls.set(callId, { callId, request: normalized, state: 'resolved', result });
    turn.compactionDeliveryCount++;
    turn.activityRevision++;
    wakeAll(turn);
    return Promise.resolve(result);
  }

  let resolveCall;
  let rejectCall;
  const promise = new Promise((resolve, reject) => {
    resolveCall = resolve;
    rejectCall = reject;
  });
  const call = {
    callId,
    request: normalized,
    state: "queued",
    result: null,
    resolve: resolveCall,
    reject: rejectCall,
    promise,
    timer: null,
    createdAt: Date.now(),
    dispatchedAt: null,
  };
  call.timer = setTimeout(() => {
    if (call.state === "resolved" || call.state === "cancelled") return;
    if (call.state === "queued") {
      removeQueued(turn, callId);
      call.state = "expired";
      boundedSet(callTombstones, callId, { state: "expired", key: turn.key, at: Date.now() });
      call.reject(new Error("the Codex tool request expired before dispatch"));
    } else {
      call.state = "ambiguous";
      boundedSet(callTombstones, callId, { state: "ambiguous", key: turn.key, at: Date.now() });
      call.reject(new Error("the dispatched Codex tool timed out; whether its side effect occurred is uncertain and it will not be retried"));
      // Reference MCP invocation timeout retires the binding. Leaving the owned
      // Web generation alive after its native client fails leaks browser capacity.
      if (turn.cancelBrowser) end(turn.key, 'The dispatched native tool timed out; inspect its native receipt before retrying');
    }
    turn.activityRevision += 1;
    wakeAll(turn);
  }, Math.max(1, timeoutMs));
  turn.calls.set(callId, call);
  turn.activityRevision += 1;
  const enqueue = () => {
    if (turn.closed || call.state !== 'queued') return;
    turn.queue.push({ callId, ...normalized });
    wakeAll(turn);
  };
  if (turn.toolBoundaryObserver) {
    // Reference tool-batch acknowledgement: capture the exact visible answer
    // before permitting native execution. This wait is inside the call TTL.
    Promise.resolve().then(turn.toolBoundaryObserver).then(enqueue, () => {
      if (turn.closed || call.state !== 'queued') return;
      clearTimeout(call.timer);
      call.state = 'cancelled';
      turn.activityRevision += 1;
      boundedSet(callTombstones, callId, { state: 'cancelled', key: turn.key, at: Date.now() });
      call.reject(new Error('Could not observe the pre-tool answer boundary; no native tool was dispatched'));
      wakeAll(turn);
    });
  } else enqueue();
  return promise;
}

function claimQueue(turn, roundId) {
  const claimed = [];
  while (turn.queue.length) {
    const entry = turn.queue.shift();
    const call = turn.calls.get(entry.callId);
    if (!call || call.state !== "queued") continue;
    call.state = "dispatched";
    call.dispatchedAt = Date.now();
    claimed.push(entry);
  }
  if (!claimed.length) return null;
  const result = claimed.length === 1 ? { tool: claimed[0] } : { tools: claimed };
  turn.rounds.set(roundId, { state: "tool-boundary", result, at: Date.now() });
  return result;
}

// Reference requestCompaction: queued/future work receives a control result;
// already dispatched native results remain untouched and are delivered normally.
function requestCompaction(key, result) {
  const turn = get(key);
  if (!turn || turn.compactionResult || turn.activeRound) throw Error('Active compaction requires an unowned native tool boundary');
  turn.compactionResult = structuredClone(result);
  turn.compactionDeliveryCount = 0;
  for (const call of turn.calls.values()) if (call.state === 'queued') {
    clearTimeout(call.timer); removeQueued(turn, call.callId);
    call.state = 'resolved'; call.result = structuredClone(result);
    call.resolve(call.result); turn.compactionDeliveryCount++;
  }
  turn.activityRevision++;
  wakeAll(turn);
}

function waitSignal(turn) {
  let waiter;
  const promise = new Promise((resolve, reject) => {
    waiter = { resolve, reject };
    turn.waiters.add(waiter);
  });
  return { promise, waiter };
}

// Only one HTTP round may own a browser continuation at a time. Retrying a completed tool boundary
// is rejected instead of replaying a potentially side-effecting native request.
async function waitForTool(key, race, { roundId = randomId("round") } = {}) {
  const turn = get(key);
  if (!turn) throw closedError("the Codex turn is not active");
  const prior = turn.rounds.get(roundId);
  if (prior) throw new Error(`HTTP round ${roundId} was already ${prior.state}; it cannot be submitted again`);
  if (turn.activeRound && turn.activeRound !== roundId) {
    throw new Error(`another HTTP round (${turn.activeRound}) already owns this browser turn`);
  }
  turn.activeRound = roundId;
  turn.rounds.set(roundId, { state: "waiting", at: Date.now() });
  const browser = Promise.resolve(race).then(
    (value) => ({ type: "browser", value }),
    (error) => ({ type: "browser-error", error }),
  );

  try {
    while (true) {
      if (turn.closed) throw closedError(turn.closeReason);
      const claimed = claimQueue(turn, roundId);
      if (claimed) return claimed;
      const waiting = waitSignal(turn);
      const signal = waiting.promise.then(() => ({ type: "wake" }));
      const winner = await Promise.race([browser, signal]);
      turn.waiters.delete(waiting.waiter);
      if (winner.type === "wake") continue;
      if (winner.type === "browser-error") throw winner.error;
      if ([...turn.calls.values()].some(call => ["queued", "dispatched", "ambiguous"].includes(call.state))) {
        throw new Error("browser finished with pending or uncertain native tools; a final answer cannot complete this turn");
      }
      const result = { done: winner.value };
      turn.rounds.set(roundId, { state: "browser-complete", result, at: Date.now() });
      return result;
    }
  } finally {
    if (turn.activeRound === roundId) turn.activeRound = null;
  }
}

function deliverOutputs(key, outputs, {contextUpdates=[]}={}) {
  const turn = get(key);
  return (Array.isArray(outputs) ? outputs : []).map(({ callId, result }) => {
    if (typeof callId !== "string" || !callId) return { callId: callId ?? null, status: "unknown" };
    const call = turn?.calls.get(callId);
    if (!call) {
      const tombstone = callTombstones.get(callId);
      return { callId, status: tombstone ? "stale" : "unknown", priorState: tombstone?.state ?? null };
    }
    if (call.state === "resolved") return { callId, status: sameRequest(call.result, result) ? "duplicate" : "conflict" };
    if (call.state === "queued") return { callId, status: "stale", priorState: "not-dispatched" };
    if (call.state !== "dispatched") return { callId, status: "stale", priorState: call.state };
    clearTimeout(call.timer);
    call.state = "resolved";
    call.result = result;
    turn.activityRevision += 1;
    turn.completed.set(callId, result);
    boundedSet(callTombstones, callId, { state: "resolved", key: turn.key, at: Date.now() });
    // Keep canonical native receipts unchanged for duplicate/conflict checks.
    // Async native agent messages are separate transport context, not invented
    // native output. Without this, a waiting Web parent never sees its child.
    call.transportResult=contextUpdates.length ? {
      ...result,
      content:[...(result?.content??[]),{type:'text',text:'Codex runtime context update (separate from the native tool result; preserve author/recipient roles):\n'+JSON.stringify(contextUpdates)}],
      _meta:{...result?._meta,codexpp_runtime_context:structuredClone(contextUpdates)},
    } : result;
    call.resolve(call.transportResult);
    wakeAll(turn);
    return { callId, status: "accepted" };
  });
}

function deliverOutput(key, callId, output) {
  const [status] = deliverOutputs(key, [{ callId, result: output }]);
  return status?.status === "accepted";
}

function cancelTool(token, callId, reason = "the tool client cancelled") {
  const turn = byToken.get(token);
  const call = turn?.calls.get(callId);
  if (!call || !["queued", "dispatched"].includes(call.state)) return false;
  const dispatched = call.state === "dispatched";
  clearTimeout(call.timer);
  removeQueued(turn, callId);
  call.state = dispatched ? "ambiguous" : "cancelled";
  turn.activityRevision += 1;
  boundedSet(callTombstones, callId, { state: call.state, key: turn.key, at: Date.now() });
  call.reject(new Error(dispatched ? `${reason}; dispatched side effect is uncertain and will not be retried` : reason));
  if (dispatched && turn.cancelBrowser) end(turn.key, `${reason}; dispatched side effect is uncertain and will not be retried`);
  wakeAll(turn);
  return true;
}

// Adapted from the reference's begin/commitCompletionFence, MIT; see THIRD_PARTY_NOTICES.md.
function beginCompletionFence(token) {
  const turn = byToken.get(token);
  if (!turn || turn.closed) throw closedError();
  if ([...turn.calls.values()].some(call => ["queued", "dispatched", "ambiguous"].includes(call.state))) return undefined;
  return turn.activityRevision;
}

function commitCompletionFence(token, revision) {
  if (!Number.isSafeInteger(revision)) return false;
  const current = beginCompletionFence(token);
  if (current !== revision) return false;
  byToken.get(token).completionCommitted = true;
  return true;
}

function end(key, reason) {
  const turn = byKey.get(key);
  if (!turn || turn.closed) return false;
  turn.closed = true;
  turn.state = "closed";
  turn.closeReason = reason ?? "the Codex turn ended";
  byKey.delete(key);
  byToken.delete(turn.token);
  boundedSet(turnTombstones, key, {
    state: "closed",
    turnId: turn.turnId,
    epoch: turn.epoch,
    reason: turn.closeReason,
    at: Date.now(),
  });
  rememberToken(turn.token);
  for (const call of turn.calls.values()) {
    clearTimeout(call.timer);
    if (["queued", "dispatched"].includes(call.state)) {
      call.state = "cancelled";
      boundedSet(callTombstones, call.callId, { state: "cancelled", key, at: Date.now() });
      call.reject(closedError(turn.closeReason));
    }
  }
  turn.queue.length = 0;
  const error = closedError(turn.closeReason);
  for (const waiter of turn.waiters) waiter.reject(error);
  turn.waiters.clear();
  if (turn.cancelBrowser) {
    try { turn.cancelBrowser(error); } catch {}
  }
  turn.browser = null;
  turn.physicalSettlement = null;
  turn.sourceRequest = null;
  turn.compactionResult = null;
  turn.chatKey = null;
  turn.cancelBrowser = null;
  turn.toolBoundaryObserver = null;
  turn.registry.length = 0;
  turn.progress.length = 0;
  turn.progressListeners.clear();
  turn.activeRound = null;
  turn.calls.clear(); turn.completed.clear(); turn.rounds.clear();
  turn.historicalCallIds?.clear();
  return true;
}

function endAll(reason = "the Codex++ hub is shutting down") {
  for (const key of [...byKey.keys()]) end(key, reason);
  require('./web-compaction.cjs').endAll(reason);
}

function snapshot(key) {
  const turn = byKey.get(key);
  if (!turn) return null;
  const counts = {};
  for (const call of turn.calls.values()) counts[call.state] = (counts[call.state] ?? 0) + 1;
  return {
    key: turn.key,
    turnId: turn.turnId,
    state: turn.state,
    queue: turn.queue.length,
    waiters: turn.waiters.size,
    activeRound: turn.activeRound,
    calls: counts,
    hasToken: byToken.has(turn.token),
  };
}

module.exports = {
  activeForThread: (threadId) => [...byKey.values()].filter(turn => !turn.closed && turn.threadId === threadId),
  begin,
  get,
  status,
  attach,
  publishProgress,
  subscribeProgress,
  requestTool,
  requestCompaction,
  setToolBoundaryObserver,
  cancelTool,
  beginCompletionFence,
  commitCompletionFence,
  waitForTool,
  deliverOutput,
  deliverOutputs,
  end,
  revoke: end,
  endAll,
  snapshot,
};
