// Adapted from codex-chatgpt-web compaction-transaction/native-compaction-control
// (MIT, e85e3693). Full attribution and license: ../THIRD_PARTY_NOTICES.md.
const { randomBytes } = require('node:crypto');
const WIRE_NAME = 'codex.control.compaction_handoff';
const TIMEOUT_MS = 300_000;
const MAX_SUMMARY_BYTES = 128 * 1024;
const transactions = new Map();

function begin(identity, { timeoutMs = TIMEOUT_MS, signal } = {}) {
  if (!identity?.threadId || !identity?.turnId) throw new Error('Checkpoint requires native thread and turn identity');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > TIMEOUT_MS) throw new Error('Invalid checkpoint timeout');
  if (transactions.size >= 16) throw new Error('Checkpoint capacity is occupied');
  const token = `cxpc_${randomBytes(24).toString('hex')}`;
  const handoffId = `handoff_${randomBytes(16).toString('hex')}`;
  const controller = new AbortController();
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // The browser can still be preparing when the native client cancels.
  promise.catch(() => {});
  const finish = (error, summary) => {
    if (!transactions.delete(token)) return;
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancelled);
    if (error) { reject(error); controller.abort(error); } else resolve(summary);
  };
  const cancelled = () => finish(signal.reason instanceof Error ? signal.reason : new Error('Checkpoint cancelled'));
  const timer = setTimeout(() => finish(new Error('Checkpoint handoff timed out')), timeoutMs);
  transactions.set(token, { handoffId, finish, identity });
  signal?.addEventListener('abort', cancelled, { once: true });
  if (signal?.aborted) cancelled();
  return { token, handoffId, promise, signal: controller.signal, abort: (error = new Error('Checkpoint revoked')) => finish(error) };
}

function submit(token, request) {
  const tx = transactions.get(token);
  if (!tx) throw new Error('Checkpoint control token is invalid, expired, or consumed');
  const args = request?.bridgeArguments;
  if (request.bridgeTool !== 'codex_tool_call' || args?.wire_name !== WIRE_NAME || args.kind !== 'function') {
    throw new Error('Checkpoint token permits only the reserved handoff');
  }
  if (args.arguments?.handoff_id !== tx.handoffId) throw new Error('Checkpoint handoff id does not match');
  const summary = args.arguments?.summary;
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('Checkpoint summary is empty');
  if (Buffer.byteLength(summary, 'utf8') > MAX_SUMMARY_BYTES) throw new Error('Checkpoint summary exceeds 128 KiB');
  tx.finish(null, summary.trim());
  return { content: [{ type: 'text', text: '{"submitted":true}' }], structuredContent: { submitted: true }, isError: false };
}

function instruction(tx) {
  return [
    'Automatic Codex context compaction: create a concise checkpoint preserving decisions, constraints, completed work, tool evidence, remaining work and the latest user intent.',
    'Do not run tools or continue the task except for the single reserved checkpoint submission below. This control token has no ordinary native tool authority.',
    'Use the already attached Codex++ Native v2 connector. Submit the complete checkpoint exactly once using codex_tool_call with this binding:',
    JSON.stringify({ turn_token: tx.token, request_id:tx.handoffId, wire_name: WIRE_NAME, kind: 'function', arguments: { handoff_id: tx.handoffId, summary: '<complete checkpoint summary>' } }),
    'Do not call codex_exec, codex_tool_inventory, or any work tool. After submitted=true call no more tools; the bridge will retire this checkpoint response.',
  ].join('\n');
}

async function run(webSession, options, compiled) {
  const tx = begin(options.identity, { signal: options.signal });
  try {
    if (options.activeSource) {
      await settleActiveSource(options.activeSource, options.compactionRequest, require('./turn-broker.cjs'), { signal: tx.signal });
      // These exact source results were acknowledged by this retained browser.
      webSession.commitContext(options.key, options.compactionRequest, [], { stripCompactionTrigger: true });
    }
    const result = await webSession.runTurn({ ...options, timeoutMs: TIMEOUT_MS, signal: tx.signal,
      compaction: { ...tx, instruction: instruction(tx), records: compiled.records.filter(item => item.type !== 'compaction_trigger') },
    });
    if (result.checkpoint !== true) throw new Error('Structured checkpoint handoff was not delivered; ordinary assistant text is not compaction');
    return result;
  } finally { tx.abort(); }
}

async function settleActiveSource(source, request, broker, { signal } = {}) {
  const outputs = require('./web-contract.cjs').extractToolOutputs(request).filter(output => !source.historicalCallIds?.has(output.callId));
  const required = [...source.calls.values()].filter(call => call.state === 'dispatched');
  if (!source.browser || source.activeRound || source.closed || source.compactionResult
    || [...source.calls.values()].some(call => call.state === 'ambiguous')) throw Error('Active compaction source is not at a safe native tool boundary');
  const seen = new Set();
  for (const output of outputs) {
    const call = source.calls.get(output.callId);
    if (seen.has(output.callId) || !call || !['dispatched','resolved'].includes(call.state)) throw Error('Active compaction has duplicate or unknown tool results');
    if (call.state === 'resolved' && !require('node:util').isDeepStrictEqual(call.result, output.result)) throw Error('Active compaction tool result conflicts with accepted evidence');
    seen.add(output.callId);
  }
  if (!required.every(call => seen.has(call.callId))) throw Error('Active compaction is missing required native tool results; source left unchanged');
  signal?.throwIfAborted();
  const abort = () => broker.end(source.key, 'Active compaction cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  try {
    broker.requestCompaction(source.key, { isError: true, content: [{ type: 'text', text:
      'Codex context compaction is now in progress. This new tool request was not executed. Do not retry or request other tools. End this response; a separate checkpoint handoff follows. Preserve the real results already delivered.' }] });
    const statuses = broker.deliverOutputs(source.key, outputs);
    if (statuses.some(item => !['accepted','duplicate'].includes(item.status))) throw Error('Active compaction could not deliver its native results');
    const observe = require('./web-session.cjs').observe;
    const outcome = await observe(source.browser, { signal, timeoutMs: TIMEOUT_MS, label: 'Active compaction source' });
    await observe(source.physicalSettlement, { signal, timeoutMs: TIMEOUT_MS, label: 'Active compaction physical settlement' });
    return outcome;
  } finally {
    signal?.removeEventListener('abort', abort);
    broker.end(source.key, 'Active source retired for compaction');
  }
}

function cancelThread(threadId, turnId) {
  let cancelled = false;
  for (const tx of [...transactions.values()]) if (tx.identity.threadId === threadId && tx.identity.turnId === turnId) {
    tx.finish(new Error('Native checkpoint cancelled')); cancelled = true;
  }
  return cancelled;
}

function endAll(reason = 'Checkpoint broker is shutting down') {
  for (const tx of [...transactions.values()]) tx.finish(new Error(reason));
}

module.exports = { WIRE_NAME, TIMEOUT_MS, MAX_SUMMARY_BYTES, begin, submit, instruction, run, settleActiveSource, cancelThread, endAll, size: () => transactions.size };
