import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const integration = path.join(root, 'integrations', 'claude-peers');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cxp-peers-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('cxp-peers-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function install(dir, remove = false) {
  const result = spawnSync(process.execPath, [path.join(integration, 'install.mjs'),
    '--codex-home', dir, ...(remove ? ['--remove'] : [])], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('installer skips absent config, is idempotent, and preserves backups', t => {
  const dir = fixture(t), config = path.join(dir, 'config.toml');
  install(dir);
  assert.equal(fs.existsSync(path.join(dir, 'mcp')), false);
  const original = 'model = "test"\n[mcp_servers.other]\ncommand = "other"\n';
  fs.writeFileSync(config, original);
  install(dir);
  const installed = fs.readFileSync(config, 'utf8');
  install(dir);
  assert.equal(fs.readFileSync(config, 'utf8'), installed);
  assert.ok(fs.existsSync(path.join(dir, 'mcp', 'claude-peers', 'server.mjs')));
  install(dir, true);
  assert.equal(fs.readFileSync(config, 'utf8').trim(), original.trim());
  const backups = fs.readdirSync(dir).filter(n => n.includes('.bak-claude-peers-'));
  assert.equal(backups.length, 2, 'install and removal must keep separate backups');
  assert.ok(backups.some(n => fs.readFileSync(path.join(dir, n), 'utf8') === original));
});

test('installer ignores markers in comments and multiline strings', t => {
  const dir = fixture(t), config = path.join(dir, 'config.toml');
  const original = '# example: [mcp_servers.claude_peers]\nmodel = "test"\nnotes = """\n[mcp_servers.claude_peers]\nexample only\n"""\n[mcp_servers.other]\ncommand = "other"\n';
  fs.writeFileSync(config, original);
  install(dir);
  assert.ok(fs.readFileSync(config, 'utf8').startsWith(original));
  install(dir, true);
  assert.equal(fs.readFileSync(config, 'utf8').trim(), original.trim());
});

test('installer removes owned subtables but preserves indented unrelated sections', t => {
  const dir = fixture(t), config = path.join(dir, 'config.toml');
  fs.writeFileSync(config, '[mcp_servers.claude_peers]\ncommand="old"\n[mcp_servers.claude_peers.env]\nEXAMPLE="value"\n  [mcp_servers.other]\ncommand="keep"\n');
  install(dir, true);
  assert.equal(fs.readFileSync(config, 'utf8'), '  [mcp_servers.other]\ncommand="keep"\n');
});

test('installer accepts quoted keys and preserves array tables and environment overrides', t => {
  const dir = fixture(t), config = path.join(dir, 'config.toml');
  fs.writeFileSync(config, '["mcp_servers" . \'claude_peers\']\ncommand="old"\n[mcp_servers.claude_peers.env]\nEXAMPLE="keep"\n[[skills.config]]\npath="keep"\n');
  install(dir);
  const updated = fs.readFileSync(config, 'utf8');
  assert.ok(updated.includes('[mcp_servers.claude_peers.env]\nEXAMPLE="keep"'));
  assert.ok(updated.includes('[[skills.config]]\npath="keep"'));
  assert.equal(updated.includes('command="old"'), false);
  install(dir, true);
  assert.equal(fs.readFileSync(config, 'utf8').trim(), '[[skills.config]]\npath="keep"');
});

test('Windows scripts parse and registration respects CODEX_HOME and skip flag', { skip: process.platform !== 'win32' }, t => {
  const dir = fixture(t), config = path.join(dir, 'config.toml');
  fs.writeFileSync(config, 'model="test"\n');
  const script = path.join(dir, 'installer-test.ps1');
  fs.writeFileSync(script, `param([string]$RepoRoot, [string]$TestHome)
$ErrorActionPreference = 'Stop'
$env:CODEX_HOME = $TestHome
foreach ($file in @('install.ps1', 'uninstall.ps1')) {
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $RepoRoot "install/windows/$file"), [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw ($errors | Out-String) }
  if ($file -eq 'install.ps1') {
    $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Install-ClaudePeers' }, $true)
    . ([scriptblock]::Create($fn.Extent.Text))
  }
}
function Info($message) {}
$SkipClaudePeers = $true
Install-ClaudePeers
if (Test-Path (Join-Path $TestHome 'mcp')) { throw 'Skip flag ignored' }
$SkipClaudePeers = $false
Install-ClaudePeers
if ($LASTEXITCODE -ne 0) { throw 'Registration failed' }
`);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, root, dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'mcp', 'claude-peers', 'server.mjs')));
});

async function peer(t) {
  const dir = fixture(t);
  const sessions = path.join(dir, 'sessions');
  fs.mkdirSync(sessions);
  const child = spawn(process.execPath, [path.join(integration, 'server.mjs')], {
    env: { ...process.env, CLAUDE_SESSIONS_DIR: sessions, CLAUDE_PEERS_NAME: 'test-codex',
      CLAUDE_PEERS_REQUIRE_AUTH: '0', XDG_RUNTIME_DIR: dir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit');
  let seq = 0, buffer = '', stderr = '';
  const pending = new Map();
  child.stderr.setEncoding('utf8').on('data', s => { stderr += s; });
  child.stdout.setEncoding('utf8').on('data', s => {
    buffer += s;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      pending.get(message.id)?.(message);
    }
  });
  t.after(async () => {
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 2000);
    await exit;
    clearTimeout(timer);
    assert.equal(fs.existsSync(path.join(sessions, `${child.pid}.json`)), false, stderr);
  });
  function rpc(method, params = {}) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timed out: ${method}; ${stderr}`)); }, 5000);
      pending.set(id, response => { clearTimeout(timer); pending.delete(id); resolve(response); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async function call(name, args = {}) {
    const response = await rpc('tools/call', { name, arguments: args });
    assert.equal(response.result?.isError, undefined, JSON.stringify(response));
    return JSON.parse(response.result.content[0].text);
  }
  assert.equal((await rpc('initialize')).result.serverInfo.name, 'claude-peers');
  const address = await call('claude_peer_address');
  assert.equal(address.listening, true);
  return { dir, sessions, child, rpc, call, socket: address.address.slice(4) };
}

async function incoming(socket, frames, splitAt = null) {
  const conn = net.connect(socket);
  let replies = '';
  conn.on('data', s => { replies += s; });
  await once(conn, 'connect');
  const bytes = Buffer.from(frames.map(f => JSON.stringify(f)).join('\n') + '\n');
  if (splitAt !== null) {
    const index = bytes.indexOf(Buffer.from(splitAt)) + 1;
    conn.write(bytes.subarray(0, index));
    await delay(40);
    conn.write(bytes.subarray(index));
  } else conn.write(bytes);
  conn.end();
  await once(conn, 'close');
  assert.equal(replies, '', 'peer transport must not emit acknowledgements');
}
const frame = (sender, body) => ({ type: 'user', message: { role: 'user',
  content: `<cross-session-message from="uds:test-${sender}" from-name="${sender}">\n${body}\n</cross-session-message>` } });

test('filtered reads preserve other senders and their message order', async t => {
  const p = await peer(t);
  await incoming(p.socket, [frame('alpha', 'first'), frame('beta', 'second'), frame('alpha', 'third')]);
  assert.equal((await p.call('read_claude_messages', { from_name: 'beta' })).messages[0].body, 'second');
  const remaining = (await p.call('read_claude_messages', { from_name: 'ALPHA' })).messages;
  assert.deepEqual(remaining.map(m => m.body), ['first', 'third']);
  assert.ok(remaining.every(m => m.from === 'uds:test-alpha' && m.receivedAt > 0));
});

test('peer transport preserves UTF-8 split across socket chunks', async t => {
  const p = await peer(t);
  await incoming(p.socket, [frame('alpha', 'caf\u00e9')], '\u00e9');
  assert.equal((await p.call('read_claude_messages')).messages[0].body, 'caf\u00e9');
});

test('MCP exposes four tools and sends auth/user frames only to an isolated mock peer', async t => {
  const p = await peer(t);
  assert.equal((await p.rpc('tools/list')).result.tools.length, 4);
  const socket = process.platform === 'win32' ? `\\\\.\\pipe\\cxp-test-${randomUUID()}` : path.join(p.dir, 'target.sock');
  const frames = [];
  const server = net.createServer(conn => {
    conn.setEncoding('utf8');
    let buffer = '';
    conn.on('data', s => { buffer += s; });
    conn.on('end', () => {
      for (const line of buffer.split('\n').filter(Boolean)) frames.push(JSON.parse(line));
    });
    conn.on('error', () => {});
  });
  server.listen(socket);
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const token = randomUUID();
  fs.writeFileSync(path.join(p.sessions, `${process.pid}.json`), JSON.stringify({ pid: process.pid, name: 'mock', messagingSocketPath: socket, version: '2.1.0' }));
  fs.writeFileSync(path.join(p.sessions, `${process.pid}.test.key`), JSON.stringify({ peerToken: token }));
  const sessions = await p.call('list_claude_sessions', { only_addressable: true });
  assert.equal(sessions.count, 1);
  assert.equal(sessions.sessions[0].name, 'mock');
  assert.equal((await p.call('send_message_to_claude', { name: 'mock', message: 'test message' })).delivered, true);
  for (let i = 0; frames.length < 2 && i < 30; i++) await delay(20);
  assert.equal(frames[0].type, 'auth');
  assert.ok(frames[0].token === token, 'mock token must match without printing it');
  assert.equal(frames[1].message.role, 'user');
  assert.ok(frames[1].message.content.includes('test message'));
  assert.ok(frames[1].message.content.includes('SendMessage'));
  assert.equal((await p.call('read_claude_messages')).count, 0, 'probes do not create inbox messages');
});
