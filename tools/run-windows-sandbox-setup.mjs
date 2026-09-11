// Explicit one-off native setup. No threads or tool execution.
// Native provisioning mutates OS accounts/ACLs and may persist windows.sandbox in the private home.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveInstalledCodexBinary } from './installed-paths.mjs';

const home = path.resolve(process.argv[2] ?? '');
const cwd = path.resolve(process.argv[3] ?? '');
if (process.platform !== 'win32' || !process.argv[2] || !process.argv[3]
  || !fs.existsSync(path.join(home, '.codexpp-home.json')) || !fs.statSync(cwd).isDirectory()) {
  throw new Error('Usage: node tools/run-windows-sandbox-setup.mjs <existing private CodexPP home> <test workspace>');
}
// Engine 0.153.4 full setup resets passwords for these machine-wide accounts.
// Do not invalidate another CODEX_HOME's credentials. No secret store is read/copied.
const existingUsers = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_UserAccount -Filter \"LocalAccount = True AND (Name = 'CodexSandboxOffline' OR Name = 'CodexSandboxOnline')\").Count",
], { encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 4096 }).trim();
if (!/^[0-2]$/.test(existingUsers)) throw new Error('Cannot verify sandbox account ownership; native setup was not started');
if (Number(existingUsers) > 0) {
  throw new Error('BLOCKED: machine-wide Codex sandbox accounts already exist. Native setup may reset their passwords and break another installation. No setup was started; resolve shared sandbox ownership first.');
}
const child = spawn(resolveInstalledCodexBinary(), [
  '-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="on-request"', 'app-server',
], { cwd, env: { ...process.env, CODEX_HOME: home }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let sequence = 0;
let buffer = '';
const pending = new Map();
let finishSetup;
const completed = new Promise(resolve => { finishSetup = resolve; });
const closed = new Promise(resolve => child.once('close', resolve));
child.once('error', error => {
  for (const waiter of pending.values()) waiter.reject(error);
  finishSetup({ success: false, error: error.message });
});
child.once('exit', code => {
  for (const waiter of pending.values()) waiter.reject(new Error(`Native setup engine exited (${code})`));
  finishSetup({ success: false, error: `Native setup engine exited (${code})` });
});
child.stderr.resume(); // Do not emit unrelated startup/auth logs.
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.method === 'windowsSandbox/setupCompleted') finishSetup(message.params);
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  }
});
function request(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
const deadline = setTimeout(() => {
  const error = new Error('Native setup did not complete within 120 seconds');
  for (const waiter of pending.values()) waiter.reject(error);
  finishSetup({ success: false, pending: true, error: error.message });
}, 120_000);
try {
  await request('initialize', { clientInfo: { name: 'codexpp-setup', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'notifications/initialized' }) + '\n');
  console.log(JSON.stringify({ before: await request('windowsSandbox/readiness', {}) }));
  const started = await request('windowsSandbox/setupStart', { mode: 'elevated', cwd });
  console.log(JSON.stringify({ started, permissionOverride: 'workspace-write', overrideScope: 'process' }));
  if (!started.started) throw new Error('Native setup did not start');
  const result = await completed;
  console.log(JSON.stringify({ completed: result }));
  if (result.success) console.log(JSON.stringify({ after: await request('windowsSandbox/readiness', {}) }));
  else process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 3000);
  await closed;
  clearTimeout(timer);
}
