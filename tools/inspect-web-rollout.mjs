// Read-only, metadata-only inspection of one explicitly supplied test rollout.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const file = process.argv[2];
const rows = fs.readFileSync(file, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
const describe = p => ({ type: p.type, role: p.role, keys: Object.keys(p), content: p.content?.map?.(c => ({ type: c.type, chars: c.text?.length })), transparent: p.encrypted_content?.startsWith('ocx1:') });
if (process.argv.includes('--restore-proof')) {
  const checkpoint = rows.findLast(r=>r.type==='compacted'), turn = rows.findLast(r=>r.type==='turn_context');
  const request = { input: [...checkpoint.payload.replacement_history, ...rows.slice(rows.indexOf(checkpoint)+1).filter(r=>r.type==='response_item').map(r=>r.payload)],
    client_metadata:{'x-codex-turn-metadata':{thread_id:rows[0].payload.id,turn_id:turn.payload.turn_id,context_window_id:checkpoint.payload.window_id}} };
  const contract = require('../hub/web-contract.cjs');
  const restored = require('../hub/web-history.cjs').restoreFromRollout(request, rows);
  const normalized = contract.normalizeInput(restored);
  const compiled = contract.compilePrompt(restored, {harness:false,preflightBudget:false});
  console.log(JSON.stringify({restored:true,records:normalized.records.length,images:normalized.images.length,epochPreserved:contract.parseTurnIdentity(request).epoch===contract.parseTurnIdentity(restored).epoch,
    budget:contract.promptBudget(compiled.text,{effortIndex:1,proAvailable:true,images:compiled.images})}));
} else console.log(JSON.stringify({ size: fs.statSync(file).size, metadata: { id: rows[0].payload.id, keys: Object.keys(rows[0].payload) },
  counts: rows.reduce((a, r) => (a[r.type] = (a[r.type] ?? 0) + 1, a), {}),
  checkpoints: rows.flatMap((r, index) => r.type === 'compacted' ? [{ index, time: r.timestamp, keys: Object.keys(r.payload), priorTypes: rows.slice(Math.max(0,index-4),index).map(p=>[p.type,p.payload.type,p.payload.role]), history: r.payload.replacement_history?.map(describe) }] : []),
  tail: rows.slice(-10).map(r => ({ time: r.timestamp, type: r.type, item: describe(r.payload), turn: r.payload.turn_id })),
}, null, 2));
