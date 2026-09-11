// Read-only diagnostic: never reads auth or .sandbox-secrets.
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.argv[2], { readOnly: true });
try {
  const rows = db.prepare(`SELECT ts, level, target, substr(feedback_log_body,1,2000) AS message
    FROM logs WHERE target LIKE '%sandbox%' OR
      (feedback_log_body LIKE '%sandbox%setup%' AND level IN ('ERROR','WARN'))
    ORDER BY id DESC LIMIT 30`).all();
  for (const row of rows) {
    row.message = row.message?.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_.-]+/g, '[redacted]')
      .replace(/(password|token|cookie|secret)["\s:=]+[^\s,}]+/gi, '$1=[redacted]');
    console.log(JSON.stringify(row));
  }
} finally {
  db.close();
}
