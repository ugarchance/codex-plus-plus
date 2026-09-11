import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
if (!process.argv[3]) console.log(JSON.stringify(tables));
else {
  const columns = db.prepare('PRAGMA table_info(logs)').all().map(c => c.name);
  const body = columns.includes('feedback_log_body') ? 'feedback_log_body' : 'message';
  const rows = db.prepare(`SELECT ${body} AS body FROM logs WHERE ${body} LIKE ? ORDER BY rowid DESC LIMIT 30`).all(`%${process.argv[3]}%`);
  console.log(JSON.stringify(rows.map(r => ({body:r.body.replace(/cxp_[a-f0-9]{48}/g,'[turn-token]').replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_.-]+/g,'[redacted]').slice(0,1600)}))));
}
db.close();
