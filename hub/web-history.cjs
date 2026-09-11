// Rollout ownership/path checks adapted from codex-chatgpt-web's
// codex-rollout-environment.ts (MIT e85e3693; THIRD_PARTY_NOTICES.md).
// Checkpoint expansion is Codex++ specific: the reference uses an unreadable-note
// fallback. No native encrypted payload is decoded, edited or sent to the browser.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const restored = new WeakMap();
const MAX_BYTES = 32 * 1024 * 1024;
const opaque = item => item?.type === 'compaction' && typeof item.encrypted_content === 'string' && !item.encrypted_content.startsWith('ocx1:');

function sameItem(a, b, { imageDetail = false } = {}) {
  const content = item => {
    const { id, internal_chat_message_metadata_passthrough, ...value } = item ?? {};
    if (imageDetail && Array.isArray(value.content)) value.content = value.content.map(block => {
      if (block?.type !== 'input_image') return block;
      if (block.detail != null && !['auto','low','high','original'].includes(block.detail)) throw Error('Native image detail is unsupported');
      const { detail, ...image } = block; return image;
    });
    return value;
  };
  return isDeepStrictEqual(content(a), content(b));
}

function restoreFromRollout(request, rows) {
  if (!request?.input?.some?.(opaque)) return request;
  const identity = require('./web-contract.cjs').parseTurnIdentity(request);
  if (rows[0]?.type !== 'session_meta' || rows[0].payload?.id !== identity.threadId) throw Error('Native history session identity does not match');
  const current = rows.findLast(row => row.type === 'turn_context');
  if (current?.payload?.turn_id !== identity.turnId) throw Error('Native history current turn identity does not match');
  let source = [], match;
  for (const row of rows) {
    if (row.type === 'event_msg' && /rollback|rolled_back/.test(row.payload?.type ?? '')) throw Error('Native history rollback recovery is unsupported');
    if (row.type === 'response_item') {
      // Never inspect or recover hidden reasoning, including its encrypted fields.
      if (row.payload?.type !== 'reasoning') source.push(row.payload);
    } else if (row.type === 'compacted') {
      const history = row.payload?.replacement_history;
      if (!Array.isArray(history) || !history.length) throw Error('Native history has an unsupported replacement-history format');
      const encrypted = history.filter(opaque);
      if (encrypted.length) {
        if (encrypted.length !== 1 || history.at(-1) !== encrypted[0] || !source.length) throw Error('Native checkpoint has no complete restorable source history');
        // Preserved users must be an ordered subsequence of the original source.
        let index = 0;
        for (const user of history.slice(0, -1)) {
          if (user.type !== 'message' || user.role !== 'user') throw Error('Native checkpoint retained history format is unsupported');
          while (index < source.length && !sameItem(source[index], user)) index++;
          if (index === source.length) throw Error('Native checkpoint retained user does not match source history');
          index++;
        }
        if (request.input.some(item => sameItem(item, encrypted[0]))) {
          if (match) throw Error('Native checkpoint source history is ambiguous');
          if (!identity.contextWindowId || row.payload.window_id !== identity.contextWindowId) throw Error('Native checkpoint window identity does not match');
          match = { history, source: structuredClone(source) };
        }
        // Keep the visible pre-compaction source, not an opaque placeholder.
      } else source = structuredClone(history);
    }
  }
  if (!match) throw Error('Native checkpoint has no matching canonical source history in this local thread');
  const end = request.input.findIndex(opaque), start = end - match.history.length + 1;
  if (start < 0 || !match.history.every((item, index) => sameItem(item, request.input[start + index], { imageDetail: true }))) {
    const differences = match.history.flatMap((item, index) => {
      const actual = request.input[start + index];
      if (sameItem(item, actual)) return [];
      return [{ index, expectedType: item.type, actualType: actual?.type, expectedRole: item.role, actualRole: actual?.role,
        fields: [...new Set([...Object.keys(item), ...Object.keys(actual ?? {})])].filter(key => !['id', 'internal_chat_message_metadata_passthrough'].includes(key) && !isDeepStrictEqual(item[key], actual?.[key])),
        blocks: item.content?.map?.((block,i)=>({type:block.type,actualType:actual?.content?.[i]?.type,fields:[...new Set([...Object.keys(block),...Object.keys(actual?.content?.[i]??{})])].filter(k=>!isDeepStrictEqual(block[k],actual?.content?.[i]?.[k]))})) }];
    }).slice(0, 4);
    throw Error(`Native request retained history does not match the checkpoint source boundary (start=${start}, end=${end}, differences=${JSON.stringify(differences)}); payload withheld`);
  }
  // Desktop 0.153.4 can retag input_image.detail on replay. Preserve the current
  // native image detail/provenance, but only after every image byte and other
  // message field matched. Never accept another image at the same ordinal.
  let cursor = 0;
  for (let i = 0; i < match.history.length - 1; i++) {
    while (cursor < match.source.length && !sameItem(match.source[cursor], match.history[i])) cursor++;
    if (cursor === match.source.length) throw Error('Retained user source mapping is incomplete');
    match.source[cursor++] = request.input[start + i];
  }
  const input = [...request.input.slice(0, start), ...match.source, ...request.input.slice(end + 1)];
  if (input.some(opaque)) throw Error('Native history contains an unresolved checkpoint');
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_BYTES) throw Error('Recovered native history exceeds 32 MiB; no content was truncated');
  const result = { ...request };
  // Out-of-band ownership: HTTP retries, epoch and native wire bytes still use
  // the original request. Only browser context normalization sees the expansion.
  restored.set(result, input);
  return result;
}

function restore(request, codexHome = process.env.CODEX_HOME) {
  if (!request?.input?.some?.(opaque)) return request;
  const { threadId } = require('./web-contract.cjs').parseTurnIdentity(request);
  if (!codexHome || !path.isAbsolute(codexHome) || !/^[a-f0-9-]{36}$/i.test(threadId)) throw Error('Native checkpoint recovery requires the active local Codex home and thread identity');
  const root = fs.realpathSync(path.join(codexHome, 'sessions'));
  const candidates = []; let visited = 0;
  const walk = (directory, depth) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++visited > 100_000) throw Error('Native history lookup exceeded its directory bound');
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (depth < 3 && entry.isDirectory() && /^\d+$/.test(entry.name)) walk(candidate, depth + 1);
      else if (depth === 3 && entry.isFile() && new RegExp(`^rollout-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-${threadId}\\.jsonl$`, 'i').test(entry.name)) candidates.push(candidate);
    }
  };
  walk(root, 0);
  if (candidates.length !== 1) throw Error('Native checkpoint requires exactly one canonical local rollout');
  const file = fs.realpathSync(candidates[0]), relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || fs.lstatSync(candidates[0]).isSymbolicLink()) throw Error('Native history path escapes its owner');
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BYTES) throw Error('Native history file is empty or exceeds 32 MiB');
    const data = Buffer.alloc(stat.size);
    if (fs.readSync(fd, data, 0, data.length, 0) !== data.length) throw Error('Native history changed during bounded read');
    const end = data.lastIndexOf(10);
    if (end < 0) throw Error('Native history has no complete JSONL record');
    const rows = data.subarray(0, end).toString('utf8').replace(/^\uFEFF/, '').split('\n').map(line => JSON.parse(line));
    return restoreFromRollout(request, rows);
  } finally { fs.closeSync(fd); }
}

module.exports = { restore, restoreFromRollout, inputFor: request => restored.get(request) };
