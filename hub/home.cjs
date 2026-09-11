const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const marker = '.codexpp-home.json';
const files = ['auth.json', 'config.toml', 'AGENTS.md', 'models_cache.json',
  '.codex-global-state.json', 'history.jsonl', 'session_index.jsonl'];
const directories = ['sessions', 'archived_sessions', 'skills', 'rules', 'memories',
  'plugins', 'automations', 'attachments', 'mcp'];

function canonical(target) {
  const absolute = path.resolve(target);
  const resolved = fs.existsSync(absolute) ? fs.realpathSync(absolute)
    : path.join(canonical(path.dirname(absolute)), path.basename(absolute));
  return process.platform === 'win32' ? path.toNamespacedPath(resolved).toLowerCase() : resolved;
}

function contains(parent, child) {
  const relative = path.relative(path.toNamespacedPath(parent), path.toNamespacedPath(child));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function assertSeparate(source, destination) {
  const a = canonical(source), b = canonical(destination);
  if (contains(a, b) || contains(b, a))
    throw Error('Codex++ home must be separate from the original CODEX_HOME.');
}

function copyEntry(source, destination) {
  if (!fs.existsSync(source)) return;
  const stat = fs.lstatSync(source);
  // Never recreate links back to writable state in the original home.
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(source)) copyEntry(path.join(source, name), path.join(destination, name));
  } else if (stat.isFile()) {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
}

function snapshotDatabase(source, destination, sourceHome, finalHome) {
  // VACUUM INTO includes committed WAL data without copying live journal files.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(source, { readOnly: true });
  try { db.exec("VACUUM INTO '" + destination.replaceAll("'", "''") + "'"); }
  finally { db.close(); }
  const copy = new DatabaseSync(destination);
  try {
    const columns = copy.prepare('PRAGMA table_info(threads)').all();
    if (columns.some(c => c.name === 'rollout_path') && columns.some(c => c.name === 'id')) {
      const update = copy.prepare('UPDATE threads SET rollout_path = ? WHERE id = ?');
      for (const row of copy.prepare('SELECT id, rollout_path FROM threads').all()) {
        if (typeof row.rollout_path !== 'string') continue;
        const relative = path.relative(path.toNamespacedPath(sourceHome), path.toNamespacedPath(row.rollout_path));
        // Imported threads must resume against the private transcript copy.
        if (['sessions', 'archived_sessions'].some(dir => relative.startsWith(dir + path.sep)))
          update.run(path.join(finalHome, relative), row.id);
      }
    }
  } finally { copy.close(); }
}

function initialize({ source = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), destination }) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  assertSeparate(source, destination);
  if (fs.existsSync(path.join(destination, marker))) return destination;
  if (fs.existsSync(destination) && fs.readdirSync(destination).length)
    throw Error('Codex++ home already contains uninitialized data; choose an empty private home.');
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  // Failed imports stay separate; only a completed snapshot becomes the live home.
  const staging = fs.mkdtempSync(destination + '.import-');
  for (const name of files) copyEntry(path.join(source, name), path.join(staging, name));
  if (fs.existsSync(source)) {
    for (const name of fs.readdirSync(source)) {
      if (/^(state|thread_history)_\d+\.sqlite$/.test(name))
        snapshotDatabase(path.join(source, name), path.join(staging, name), source, destination);
    }
  }
  // Capture the thread index before walking transcripts: newly created source
  // threads must not enter the snapshot after their directory was already copied.
  for (const name of directories) copyEntry(path.join(source, name), path.join(staging, name));
  fs.writeFileSync(path.join(staging, marker), JSON.stringify({ version: 1, importedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
  if (fs.existsSync(destination)) fs.rmdirSync(destination); // Verified empty above; no recursive removal.
  fs.renameSync(staging, destination);
  return destination;
}

function dataDirectory(argv = process.argv, env = process.env) {
  const arg = argv.find(a => a.startsWith('--user-data-dir='));
  const index = argv.indexOf('--user-data-dir');
  const fromArg = arg?.slice('--user-data-dir='.length) || (index >= 0 ? argv[index + 1] : null);
  return path.resolve(fromArg || env.USER_DATA_DIR || (process.platform === 'win32'
    ? path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CodexPP')
    : path.join(os.homedir(), 'Library', 'Application Support', 'CodexPP')));
}

function activate() {
  const data = dataDirectory();
  const destination = path.join(data, 'codex-home');
  const inherited = process.env.CODEX_HOME;
  const source = inherited && canonical(inherited) !== canonical(destination)
    ? inherited : path.join(os.homedir(), '.codex');
  initialize({ source, destination });
  process.env.USER_DATA_DIR = data;
  process.env.CODEX_HOME = destination;
  return destination;
}

module.exports = { initialize, activate, dataDirectory, assertSeparate };

if (require.main === module) {
  const data = process.argv[2];
  if (!data) throw Error('Usage: node hub/home.cjs <user-data-dir>');
  initialize({ destination: path.join(path.resolve(data), 'codex-home') });
  console.log('Codex++ private home is ready.');
}
