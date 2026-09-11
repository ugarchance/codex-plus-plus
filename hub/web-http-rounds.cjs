// One execution owns a bounded SSE journal; HTTP observers never own a browser submission.
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const rounds = new Map();
const retired = new Set();
const completions = new Map();
const GRACE_MS = 5000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROUNDS = 16;
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function keyOf(request, account) {
  return crypto.createHash('sha256').update(JSON.stringify(stable({ request, account }))).digest('hex');
}
function recordKey(record) {
  const value={...record}; if(value.status==='completed')delete value.status;
  return keyOf(value,null);
}
function completionEnvelope(request) {
  const {input,...rest}=request;
  return keyOf({...rest,registry:require('./web-contract.cjs').extractToolRegistry(request)},null);
}
// Reference turn-execution / index settledOutcome: a late child notification is
// not permission to submit the accepted browser turn again. Keep a small, short-
// lived final receipt, never its token/browser or canonical prompt contents.
function rememberCompletion(key,request,chatKey,text,output) {
  const contract=require('./web-contract.cjs'), records=contract.normalizeInput(request).records;
  const finalRecords=contract.contextCheckpoint(request,output).slice(records.length);
  const raw=request.client_metadata?.['x-codex-turn-metadata'];
  const metadata=typeof raw==='string'?JSON.parse(raw):raw;
  const entry={chatKey,text,envelope:completionEnvelope(request),count:records.length,
    prefix:keyOf(records.map(recordKey),null),outputs:finalRecords.map(recordKey),
    agentName:metadata?.agent_name??'/root',at:Date.now()};
  if(Buffer.byteLength(JSON.stringify(entry))>MAX_BYTES)return;
  completions.delete(key);completions.set(key,entry);
  while(completions.size>MAX_ROUNDS || [...completions.values()].reduce((n,x)=>n+Buffer.byteLength(JSON.stringify(x)),0)>MAX_BYTES)completions.delete(completions.keys().next().value);
}
function completedAnswer(key,request,chatKey) {
  const entry=completions.get(key);
  if(!entry)return null;
  if(Date.now()-entry.at>300000){completions.delete(key);return null;}
  if(entry.chatKey!==chatKey || entry.envelope!==completionEnvelope(request))return null;
  const records=require('./web-contract.cjs').normalizeInput(request).records;
  if(records.length<entry.count || keyOf(records.slice(0,entry.count).map(recordKey),null)!==entry.prefix)return null;
  const seen=new Set(records.slice(0,entry.count).filter(x=>x.type==='agent_message').map(x=>x.id));
  let outputIndex=0;
  for(const record of records.slice(entry.count)) {
    if(recordKey(record)===entry.outputs[outputIndex]){outputIndex++;continue;}
    // Only messages from a direct child to this owner may arrive after final.
    // A new user/developer/parent instruction or unknown tool receipt is not a retry.
    if(record.type!=='agent_message'||seen.has(record.id)||record.recipient!==entry.agentName
      || !record.author.startsWith(`${entry.agentName}/`) || record.author.slice(entry.agentName.length+1).includes('/'))return null;
    seen.add(record.id);
  }
  return {text:entry.text};
}
function retire(key) {
  rounds.delete(key); retired.add(key);
  while (retired.size > 2000) retired.delete(retired.values().next().value);
}
function reject(res, message) {
  res.writeHead(409, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code: 'web_round_not_replayable', message } }));
}
function observe(key, req, res, execute) {
  let entry = rounds.get(key);
  if (retired.has(key)) return reject(res, 'This Web request is already terminal; it will not be submitted again');
  if (entry?.hasToolCalls) return reject(res, 'This tool boundary may already have executed; automatic replay is unsafe. Return its existing call results or cancel the turn');
  if (!entry) {
    for (const [oldKey, old] of rounds) if (old.done && (rounds.size >= MAX_ROUNDS || Date.now() - old.endedAt > 60000)) retire(oldKey);
    if (rounds.size >= MAX_ROUNDS) return reject(res, 'Web HTTP journal capacity is occupied');
    const transport = new EventEmitter();
    const ownerRequest = new EventEmitter(); ownerRequest.headers = req.headers;
    entry = { ownerRequest, transport, observers: new Set(), chunks: [], bytes: 0, done: false, hasToolCalls: false, headers: null, timer: null };
    rounds.set(key, entry);
    transport.headersSent = false; transport.writableEnded = false;
    transport.writeHead = (code, headers) => {
      entry.headers = { code, headers }; transport.headersSent = true;
      for (const observer of entry.observers) observer.writeHead(code, headers);
    };
    transport.write = chunk => {
      if (entry.done) return false;
      const text = String(chunk);
      if (entry.bytes + Buffer.byteLength(text) > MAX_BYTES) {
        ownerRequest.emit('aborted'); transport.end();
        throw new Error('Web SSE journal exceeded its bounded size; the turn was cancelled');
      }
      entry.bytes += Buffer.byteLength(text);
      entry.hasToolCalls ||= /"type":"(?:custom_tool_call|function_call)"/.test(text);
      entry.chunks.push(text);
      for (const observer of entry.observers) if (!observer.destroyed) observer.write(text);
      return true;
    };
    transport.end = chunk => {
      if (entry.done) return;
      if (chunk !== undefined && chunk !== null) transport.write(chunk);
      entry.done = true; entry.endedAt = Date.now(); transport.writableEnded = true;
      clearTimeout(entry.timer);
      for (const observer of entry.observers) observer.end();
      entry.observers.clear();
    };
    entry.execute = () => Promise.resolve().then(() => execute(ownerRequest, transport)).catch(error => {
      if (!transport.headersSent) {
        transport.writeHead(502, { 'content-type': 'application/json' });
        transport.write(JSON.stringify({ error: { code: 'web_preflight_failed', message: error.message } }));
      }
      ownerRequest.emit('aborted'); transport.end();
    });
  }
  clearTimeout(entry.timer);
  if (entry.headers) res.writeHead(entry.headers.code, entry.headers.headers);
  for (const chunk of entry.chunks) res.write(chunk);
  if (entry.done) { res.end(); return; }
  entry.observers.add(res);
  res.once('close', () => {
    entry.observers.delete(res);
    if (entry.done || entry.observers.size) return;
    entry.timer = setTimeout(() => {
      if (entry.done || entry.observers.size) return;
      entry.ownerRequest.emit('aborted'); entry.transport.end(); retire(key);
    }, GRACE_MS);
    entry.timer.unref?.();
  });
  if (entry.execute) { const run = entry.execute; entry.execute = null; run(); }
}
function stop() {
  completions.clear();
  for (const [key, entry] of rounds) {
    clearTimeout(entry.timer);
    if (!entry.done) entry.ownerRequest.emit('aborted');
    entry.transport.end(); retire(key);
  }
}
module.exports = { observe, keyOf, stop, rememberCompletion, completedAnswer };
