const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const PREFIX = Buffer.from('CXP-DPAPI-1:');
const MAC_PREFIX = Buffer.from('CXP-MACKC-1:');
const MAC_IV = 12, MAC_TAG = 16;

// The Store Codex Electron build omits electron_browser_safe_storage.
// Secrets travel through pipes, never argv, environment variables or temp files.
function dpapi(value, decrypt) {
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = [
    '$ErrorActionPreference="Stop"',
    'Add-Type -AssemblyName System.Security',
    '$cxpInput=[Convert]::FromBase64String([Console]::In.ReadToEnd())',
    '$cxpEntropy=[Text.Encoding]::UTF8.GetBytes("CodexPP:provider-secrets:v1")',
    `$cxpOutput=[Security.Cryptography.ProtectedData]::${operation}($cxpInput,$cxpEntropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '[Console]::Out.Write([Convert]::ToBase64String($cxpOutput))'
  ].join(';');
  try {
    const output = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], {
        input: Buffer.from(value).toString('base64'), encoding: 'utf8',
        windowsHide: true, timeout: 15000, maxBuffer: 12 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    return Buffer.from(output.trim(), 'base64');
  } catch {
    throw Error('Windows secure key storage failed. Use the same Windows account or enter the key again.');
  }
}

// The macOS Codex build has the same gap. The master key lives in the login
// keychain behind install/mac/keychain.c (add-only, so a reinstall can never
// replace a key that already encrypts stored secrets); the payload is
// AES-256-GCM so the keychain round trip happens once per process.
let macMasterKey = null;
// Helper and service overrides exist for tools/test-mac-keychain.mjs; the
// Electron main process always uses the helper installed next to its binary.
const macTestOverrides = !process.versions.electron;
function macHelper() {
  return (macTestOverrides && process.env.CODEXPP_KEYCHAIN_HELPER) || path.join(path.dirname(process.execPath), 'codexpp-keychain');
}
function macRun(command, input) {
  const args = [command];
  if (macTestOverrides && process.env.CODEXPP_KEYCHAIN_SERVICE) args.push('--service', process.env.CODEXPP_KEYCHAIN_SERVICE);
  try {
    return { status: 0, output: execFileSync(macHelper(), args, {
      input, timeout: 60000, maxBuffer: 64 * 1024, stdio: ['pipe', 'pipe', 'pipe']
    }) };
  } catch (e) {
    if (typeof e.status === 'number') return { status: e.status, output: e.stdout };
    throw e;
  }
}
function macMaster() {
  if (macMasterKey) return macMasterKey;
  let read = macRun('get');
  if (read.status === 44) {
    const fresh = crypto.randomBytes(32).toString('base64');
    const added = macRun('set', fresh);
    if (added.status !== 0 && added.status !== 45) throw Error(`keychain set failed (${added.status})`);
    read = macRun('get');
  }
  if (read.status !== 0) throw Error(`keychain get failed (${read.status})`);
  const key = Buffer.from(read.output.toString('utf8').trim(), 'base64');
  if (key.length !== 32) throw Error('keychain master key has an unexpected size');
  return (macMasterKey = key);
}
function macUnavailable() {
  return Error('macOS keychain access failed. Allow Codex++ in the keychain prompt or enter the key again.');
}
const macos = {
  isEncryptionAvailable: () => { try { macMaster(); return true; } catch { return false; } },
  getSelectedStorageBackend: () => 'macos-keychain',
  encryptString: value => {
    let key;
    try { key = macMaster(); } catch { throw macUnavailable(); }
    const iv = crypto.randomBytes(MAC_IV);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([MAC_PREFIX, iv, cipher.getAuthTag(), body]);
  },
  decryptString: value => {
    if (!value.subarray(0, MAC_PREFIX.length).equals(MAC_PREFIX)) throw Error('This key format is unsupported. Enter the key again.');
    let key;
    try { key = macMaster(); } catch { throw macUnavailable(); }
    const iv = value.subarray(MAC_PREFIX.length, MAC_PREFIX.length + MAC_IV);
    const tag = value.subarray(MAC_PREFIX.length + MAC_IV, MAC_PREFIX.length + MAC_IV + MAC_TAG);
    const body = value.subarray(MAC_PREFIX.length + MAC_IV + MAC_TAG);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      throw Error('The stored key no longer matches the keychain master key. Enter the key again.');
    }
  },
  resetForTests: () => { macMasterKey = null; }
};

module.exports = process.platform === 'win32' ? {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'windows-dpapi',
  encryptString: value => Buffer.concat([PREFIX, dpapi(Buffer.from(value, 'utf8'), false)]),
  decryptString: value => {
    if (!value.subarray(0, PREFIX.length).equals(PREFIX)) throw Error('This key format is unsupported. Enter the key again.');
    return dpapi(value.subarray(PREFIX.length), true).toString('utf8');
  }
} : process.platform === 'darwin' ? macos : {
  isEncryptionAvailable: () => { try { return require('electron').safeStorage.isEncryptionAvailable(); } catch { return false; } },
  getSelectedStorageBackend: () => require('electron').safeStorage.getSelectedStorageBackend?.(),
  encryptString: value => require('electron').safeStorage.encryptString(value),
  decryptString: value => require('electron').safeStorage.decryptString(value)
};
