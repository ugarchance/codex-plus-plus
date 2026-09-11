#!/usr/bin/env node
// Local contract probe: installed engine, empty home, loopback provider, no auth or tools executed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { resolveInstalledCodexBinary } from './installed-paths.mjs';
const require = createRequire(import.meta.url);
const { ResponseStreamWriter } = require('../hub/responses-stream.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codexpp-wire-'));
const home = path.join(root, 'home');
const work = path.join(root, 'work');
fs.mkdirSync(home); fs.mkdirSync(work);
const captures = [];
const idleMode = process.env.CXP_WIRE_IDLE_MODE;
const compactMode = process.env.CXP_WIRE_COMPACT_MODE;
const continuityMode = process.env.CXP_WIRE_CONTINUITY === '1';
const multiAgentMode = process.env.CXP_WIRE_MULTI_AGENT === '1';
const spawnMode = process.env.CXP_WIRE_SPAWN === '1';
const agentVersion = process.env.CXP_WIRE_MULTI_AGENT_VERSION ?? 'v2';
const activeCompactMode=process.env.CXP_WIRE_ACTIVE_COMPACT==='1';
let fixtureToolSent=false;
let fixtureSpawned = false;
let lastCheckpoint;
const replaySource = process.env.CXP_WIRE_ROLLOUT_SOURCE;
let replayRows, replayPath;
if (replaySource) {
  replayRows = fs.readFileSync(replaySource, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const date = /^rollout-(\d{4})-(\d{2})-(\d{2})T/.exec(path.basename(replaySource));
  if (!date) throw Error('Replay source requires a canonical rollout filename');
  replayPath = path.join(home, 'sessions', ...date.slice(1), path.basename(replaySource));
  fs.mkdirSync(path.dirname(replayPath), { recursive: true });
  fs.copyFileSync(replaySource, replayPath); // one controlled thread, never auth or shared state
}
const catalogSource = process.env.CXP_WIRE_CATALOG_SOURCE;
let catalogFile;
if (catalogSource) {
  // Non-secret model metadata only; no authentication or shared configuration is copied.
  const { augmentCatalog } = require('../hub/web-model-catalog.cjs');
  catalogFile = path.join(root, 'catalog.json');
  const catalog = augmentCatalog(JSON.parse(fs.readFileSync(catalogSource, 'utf8')));
  if (multiAgentMode) for (const model of catalog.models) {
    if (model.slug === 'chatgpt-web/sol-full') model.multi_agent_version = agentVersion;
  }
  fs.writeFileSync(catalogFile, JSON.stringify(catalog));
}
const pending = new Map();
const notifications = [];
let child, serial = 0, buffer = '', currentCase = '';
const server = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (replayRows) {
      const history = replayRows.findLast(r=>r.type==='compacted').payload.replacement_history;
      const end = body.input.findIndex(x=>x.type==='compaction'), start=end-history.length+1;
      console.log(JSON.stringify({ replayBoundary:{end,start,historyCount:history.length}, comparisons:history.map((x,i)=>{
        const y=body.input[start+i]??{};
        return {index:i,type:y.type,role:y.role,differentKeys:[...new Set([...Object.keys(x),...Object.keys(y)])].filter(k=>!isDeepStrictEqual(x[k],y[k])),sameContent:isDeepStrictEqual(x.content,y.content),sameEnvelope:x.type==='compaction'?x.encrypted_content===y.encrypted_content:undefined};
      }) }));
    }
    if (continuityMode && lastCheckpoint) {
      const c = require('../hub/web-contract.cjs');
      const current = c.normalizeInput(body).records;
      const mismatch = lastCheckpoint.findIndex((r, i) => c.canonicalSuffix([r], [current[i]]) === null);
      if (mismatch >= 0) console.error(JSON.stringify({ continuityMismatch: mismatch, previousKeys: Object.keys(lastCheckpoint[mismatch]), currentKeys: Object.keys(current[mismatch] ?? {}), addedNullFields: Object.keys(current[mismatch] ?? {}).filter(k => current[mismatch][k] === null) }));
      assert.notEqual(c.canonicalSuffix(lastCheckpoint, current), null, 'Real engine replay must retain the canonical checkpoint');
    }
    // Persist only advertised schemas and structural metadata. Never persist actual prompt/auth.
    captures.push({ case: currentCase, path: req.url, bodyKeys: Object.keys(body),
      model: body.model, client_metadata: body.client_metadata,
      cacheKeyPresent: Boolean(body.prompt_cache_key), tools: body.tools,
      additionalTools: body.input?.filter(x => x.type === 'additional_tools'),
      inputTypes: body.input?.map(x => ({ type: x.type, role: x.role, keys: Object.keys(x) })),
      ...(spawnMode ? { agentMessages: body.input?.filter(x => x.type === 'agent_message') } : {}),
      identityHeaderNames: Object.keys(req.headers).filter(k => /thread|turn|request|codex/.test(k)),
    });
    const compact = require('../hub/web-contract.cjs').isCompactionRequest(body, req.url);
    if (compact === 'v1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ output: require('../hub/web-contract.cjs').buildCompactionReplacement(body, 'Local fixture checkpoint. Preserve the controlled user intent.') }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const writer = new ResponseStreamWriter(res, { model: body.model });
    writer.created();
    if(activeCompactMode&&!fixtureToolSent&&!compact){
      fixtureToolSent=true;
      const tool=require('../hub/web-contract.cjs').extractToolRegistry(body).find(x=>x.name==='get_goal');
      assert.ok(tool,'The fixture engine must advertise get_goal');
      writer.toolCalls([{...tool,callId:'fixture_pre_compact',arguments:{}}]);
      const write=res.write.bind(res);
      res.write=(chunk,...rest)=>write(typeof chunk==='string'?chunk.replace('"usage":null','"usage":{"input_tokens":100000,"output_tokens":1,"total_tokens":100001}'):chunk,...rest);
      writer.completed();res.end();return;
    }
    if (spawnMode && !fixtureSpawned) {
      fixtureSpawned = true;
      const namespace = agentVersion === 'v1' ? 'multi_agent_v1' : 'collaboration';
      writer.toolCalls([{ callId: 'fixture_spawn', wireName: `${namespace}.spawn_agent`, namespace, name: 'spawn_agent', kind: 'function', arguments: agentVersion === 'v1' ? { message:'Return CHILD-WIRE-OK. Do not call any tools.', fork_context:false } : {task_name:'wire_child', message:'Return CHILD-WIRE-OK. Do not call any tools.', fork_turns:'none'} }]);
      writer.completed(); res.end(); return;
    }
    if (compact === 'v2') { writer.compaction('Local fixture checkpoint. Preserve the controlled user intent.'); writer.completed(); res.end(); return; }
    if (idleMode) {
      const pulse = setInterval(() => { if (!res.destroyed) idleMode === 'heartbeat' ? writer.heartbeat() : res.write(': keepalive\n\n'); }, 100);
      await new Promise(r => setTimeout(r, 1500)); clearInterval(pulse);
    }
    if (!res.destroyed) {
      writer.textDelta('Local wire fixture complete.'); writer.completed();
      if (continuityMode) lastCheckpoint = require('../hub/web-contract.cjs').contextCheckpoint(body, writer.output);
      res.end();
    }
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })); }
});
function rpc(method, params) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: timeout`)); }, 30000);
    pending.set(id, msg => { clearTimeout(timer); msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function turn(threadId) {
  const start = notifications.length;
  const response = await rpc('turn/start', { threadId, ...(process.env.CXP_WIRE_EFFORT ? {effort:process.env.CXP_WIRE_EFFORT}:{}), input: [{ type: 'text', text: 'Reply with the fixture completion text. Do not call tools.' }] });
  const id = response.turn.id;
  const deadline = Date.now() + 35000;
  while (Date.now() < deadline) {
    const terminal = notifications.slice(start).find(x => x.method === 'turn/completed' && x.params.turn.id === id);
    if (terminal) {
      if (terminal.params.turn.status !== 'completed') throw new Error(JSON.stringify(terminal.params.turn.error ?? terminal.params.turn.status));
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('No terminal engine event: ' + JSON.stringify(notifications.slice(start).filter(x => x.method === 'error')));
}
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const originalArgs = ['app-server'];
  const launchArgs = catalogFile && process.env.CXP_WIRE_CATALOG_STARTUP === '1'
    ? require('../hub/web-model-catalog.cjs').engineArgs(originalArgs, { id: 'local' }, () => ({ catalogPath: catalogFile }), () => `http://127.0.0.1:${server.address().port}/backend-api/codex`)
    : originalArgs;
  if (process.env.CXP_WIRE_APP_SERVER_OVERRIDE === '1') launchArgs.push('-c', 'analytics.enabled=false');
  child = spawn(resolveInstalledCodexBinary(), launchArgs, {
    cwd: work, env: { ...process.env, CODEX_HOME: home, RUST_LOG: 'error' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stderr.on('data', () => {});
  child.stdout.on('data', data => {
    buffer += data;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (pending.has(msg.id)) { const callback = pending.get(msg.id); pending.delete(msg.id); callback(msg); }
      else if (msg.method) notifications.push(msg);
    }
  });
  child.on('error', error => { for (const callback of pending.values()) callback({ error }); pending.clear(); });
  await rpc('initialize', { clientInfo: { name: 'codexpp-wire-fixture', version: '1' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  if (catalogFile && process.env.CXP_WIRE_CATALOG_STARTUP === '1') {
    const models = await rpc('model/list', { includeHidden: true, limit: 100 });
    assert.ok(models.data.some(row => row.model === 'chatgpt-web/sol-full'), 'Installed engine ignored startup Web catalog');
  }
  for (const codeMode of (idleMode || compactMode || continuityMode || spawnMode ? [false] : [false, true])) {
    currentCase = codeMode ? 'gateway-start' : 'direct-start';
    const config = {
      'model_providers.fixture': { name: compactMode ? 'OpenAI' : 'Local fixture', base_url: `http://127.0.0.1:${server.address().port}/v1`, wire_api: 'responses', requires_openai_auth: false, stream_max_retries: 0, request_max_retries: 0, ...(idleMode ? { stream_idle_timeout_ms: 400 } : {}) },
      'features.code_mode': codeMode, 'features.code_mode_only': codeMode, 'features.plugins': false,
      ...(catalogFile ? { model_catalog_json: catalogFile } : {}),
      ...(compactMode ? { 'features.remote_compaction_v2': compactMode === 'v2' } : {}),
    };
    const params = { cwd: work, model: 'chatgpt-web/sol-full', modelProvider: 'fixture', approvalPolicy: 'never', sandbox: 'read-only', config };
    if (replayPath) {
      const resumed = await rpc('thread/resume', { ...params, threadId: replayRows[0].payload.id, path: replayPath });
      await turn(resumed.thread.id);
      break;
    }
    const started = await rpc('thread/start', params);
    await turn(started.thread.id);
    if(activeCompactMode){
      assert.ok(captures.some(x=>x.inputTypes?.some(i=>i.type==='compaction_trigger')&&x.inputTypes.some(i=>i.type==='function_call_output')), 'Engine did not carry the active tool result into compaction');
      break;
    }
    if (spawnMode) {
      const deadline = Date.now() + 30000;
      const hasChild = () => captures.some(x=>JSON.parse(x.client_metadata?.['x-codex-turn-metadata']??'{}').subagent_kind==='thread_spawn');
      while (Date.now() < deadline && !hasChild()) await new Promise(r=>setTimeout(r,100));
      assert.ok(hasChild(), 'Native child did not produce a request');
      break;
    }
    if (continuityMode) { currentCase = 'same-thread-followup'; await turn(started.thread.id); break; }
    if (compactMode) {
      const offset = notifications.length, before = captures.length;
      currentCase = `compact-${compactMode}`;
      await rpc('thread/compact/start', { threadId: started.thread.id });
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && !notifications.slice(offset).some(x => x.method === 'turn/completed')) await new Promise(r => setTimeout(r, 100));
      const errors = notifications.slice(offset).filter(x => x.method === 'error');
      if (errors.length || captures.length === before) throw new Error(`Compaction did not complete: ${JSON.stringify(errors.map(x => x.params))}`);
      const compactCapture = captures.at(-1);
      if (compactMode === 'v1' && !compactCapture.path.endsWith('/responses/compact')) throw new Error('Engine did not use remote compaction v1');
      if (compactMode === 'v2' && !compactCapture.inputTypes?.some(x => x.type === 'compaction_trigger')) throw new Error('Engine did not use remote compaction v2');
      currentCase = `after-compact-${compactMode}`;
      await turn(started.thread.id);
      break;
    }
    if (idleMode) break;
    currentCase = codeMode ? 'gateway-resume' : 'direct-resume';
    const resumed = await rpc('thread/resume', { threadId: started.thread.id, ...params });
    await turn(resumed.thread.id);
    currentCase = codeMode ? 'gateway-fork' : 'direct-fork';
    const forked = await rpc('thread/fork', { threadId: started.thread.id, ...params });
    await turn(forked.thread.id);
  }
  const destination = path.resolve(process.argv[2] ?? '.build/web-engine-wire.json');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify({ engine: resolveInstalledCodexBinary(), captures }, null, 2));
  console.log(JSON.stringify({ result: 'PASS-LOCAL', requests: captures.length, authUsed: false, toolsExecuted: spawnMode||activeCompactMode, nativeCoordinationExecuted: spawnMode, shellOrFileToolsExecuted:false, destination,
    cases: captures.map(x => ({ case: x.case, toolCount: x.tools?.length, additionalCount: x.additionalTools?.length,
      tools: (x.additionalTools ?? []).flatMap(a => a.tools.flatMap(t => t.tools?.map(y => `${t.name}.${y.name}:${y.type}`) ?? [`${t.name}:${t.type}`])) })) }, null, 2));
} finally {
  if (child) { const closed = once(child, 'close'); child.stdin.end(); child.kill(); await Promise.race([closed, new Promise(r => setTimeout(r, 2000))]); }
  server.closeAllConnections(); await new Promise(r => server.close(r));
  // Remove only the exact directory created by this probe, never a computed broad home/workspace.
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('codexpp-wire-')) throw new Error('Unsafe cleanup target');
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch (error) { console.error(JSON.stringify({ cleanup: 'NOT COMPLETE', code: error.code, retainedProbeDirectory: root, authCopied: false })); }
}
