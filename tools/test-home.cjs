const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { initialize, activate, dataDirectory } = require('../hub/home.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cxp-home-test-'));
  const source = path.join(root, 'cli'), destination = path.join(root, 'data', 'codex-home');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'config.toml'), 'model="native-model"\n');
  fs.writeFileSync(path.join(source, 'auth.json'), '{"fixture":true}\n');
  return { root, source, destination };
}

test('provider selection and authentication writes cannot mutate the original home', () => {
  const f = fixture();
  initialize(f);
  fs.writeFileSync(path.join(f.destination, 'config.toml'), 'model="cxp/test/model"\n');
  fs.writeFileSync(path.join(f.destination, 'auth.json'), '{"fixture":"switched"}\n');
  assert.equal(fs.readFileSync(path.join(f.source, 'config.toml'), 'utf8'), 'model="native-model"\n');
  assert.equal(fs.readFileSync(path.join(f.source, 'auth.json'), 'utf8'), '{"fixture":true}\n');
  initialize(f);
  assert.match(fs.readFileSync(path.join(f.destination, 'config.toml'), 'utf8'), /cxp\/test\/model/);
});

test('live WAL snapshot preserves committed threads and remaps resume paths', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.source, 'sessions'));
  const transcript = path.join(f.source, 'sessions', 'thread.jsonl');
  fs.writeFileSync(transcript, '{"fixture":true}\n');
  const db = new DatabaseSync(path.join(f.source, 'state_5.sqlite'));
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT)');
    db.prepare('INSERT INTO threads VALUES (?, ?)').run('test', transcript);
    db.prepare('INSERT INTO threads VALUES (?, ?)').run('namespaced', path.toNamespacedPath(transcript));
    initialize(f);
    const copy = new DatabaseSync(path.join(f.destination, 'state_5.sqlite'));
    try {
      for (const row of copy.prepare('SELECT * FROM threads').all()) {
        assert.equal(row.rollout_path, path.join(f.destination, 'sessions', 'thread.jsonl'));
        assert.ok(fs.existsSync(row.rollout_path));
      }
    } finally { copy.close(); }
    assert.equal(db.prepare('SELECT rollout_path FROM threads').get().rollout_path, transcript);
  } finally { db.close(); }
});

test('overlapping homes, including directory junctions, are rejected before writing', () => {
  const f = fixture();
  for (const destination of [f.source, path.join(f.source, 'nested'), f.root])
    assert.throws(() => initialize({ source: f.source, destination }), /must be separate/);
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.source, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => initialize({ source: f.source, destination: alias }), /must be separate/);
});

test('threads created during transcript copying do not create missing-file rows in the snapshot', t => {
  const f = fixture();
  fs.mkdirSync(path.join(f.source, 'sessions'));
  const transcript = path.join(f.source, 'sessions', 'first.jsonl');
  fs.writeFileSync(transcript, '{}\n');
  const db = new DatabaseSync(path.join(f.source, 'state_5.sqlite'));
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT)');
    db.prepare('INSERT INTO threads VALUES (?, ?)').run('first', transcript);
    const originalCopy = fs.copyFileSync;
    t.mock.method(fs, 'copyFileSync', (from, to, flags) => {
      if (from === transcript) {
        const late = path.join(f.source, 'sessions', 'late.jsonl');
        fs.writeFileSync(late, '{}\n');
        db.prepare('INSERT INTO threads VALUES (?, ?)').run('late', late);
      }
      return originalCopy(from, to, flags);
    });
    initialize(f);
    const snapshot = new DatabaseSync(path.join(f.destination, 'state_5.sqlite'));
    try { assert.deepEqual(snapshot.prepare('SELECT id FROM threads').all().map(r => r.id), ['first']); }
    finally { snapshot.close(); }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM threads').get().n, 2);
  } finally { db.close(); }
});

test('failed database import never becomes an active home', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.source, 'state_5.sqlite'), 'invalid sqlite fixture');
  assert.throws(() => initialize(f));
  assert.equal(fs.existsSync(f.destination), false);
  assert.equal(fs.readFileSync(path.join(f.source, 'config.toml'), 'utf8'), 'model="native-model"\n');
});

test('unknown existing private data is preserved and reported', () => {
  const f = fixture();
  fs.mkdirSync(f.destination, { recursive: true });
  fs.writeFileSync(path.join(f.destination, 'config.toml'), 'keep');
  assert.throws(() => initialize(f), /uninitialized data/);
  assert.equal(fs.readFileSync(path.join(f.destination, 'config.toml'), 'utf8'), 'keep');
});

test('first use with no original home creates an independent empty home', () => {
  const f = fixture();
  initialize({ source: path.join(f.root, 'absent'), destination: f.destination });
  assert.ok(fs.existsSync(path.join(f.destination, '.codexpp-home.json')));
});

test('launcher directory overrides inherited environment and activation is repeatable', () => {
  const f = fixture(), before = { CODEX_HOME: process.env.CODEX_HOME, USER_DATA_DIR: process.env.USER_DATA_DIR };
  const argv = process.argv;
  try {
    process.argv = ['electron', '--user-data-dir=' + path.dirname(f.destination)];
    process.env.CODEX_HOME = f.source;
    process.env.USER_DATA_DIR = path.join(f.root, 'wrong');
    assert.equal(activate(), f.destination);
    assert.equal(activate(), f.destination);
    assert.equal(process.env.CODEX_HOME, f.destination);
    assert.equal(process.env.USER_DATA_DIR, path.dirname(f.destination));
  } finally {
    process.argv = argv;
    for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
  assert.equal(dataDirectory(['electron', '--user-data-dir', f.root], {}), f.root);
});

test('links, logs, queues and sandbox credentials are not imported', () => {
  const f = fixture();
  const elsewhere = path.join(f.root, 'other-skills');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, path.join(f.source, 'skills'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const name of ['logs_2.sqlite', 'queue.sqlite', '.sandbox-secrets']) fs.writeFileSync(path.join(f.source, name), 'fixture');
  initialize(f);
  for (const name of ['skills', 'logs_2.sqlite', 'queue.sqlite', '.sandbox-secrets']) assert.equal(fs.existsSync(path.join(f.destination, name)), false);
});
