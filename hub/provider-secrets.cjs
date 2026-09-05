const { execFileSync } = require('node:child_process');
const path = require('node:path');
const PREFIX = Buffer.from('CXP-DPAPI-1:');

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

module.exports = process.platform === 'win32' ? {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'windows-dpapi',
  encryptString: value => Buffer.concat([PREFIX, dpapi(Buffer.from(value, 'utf8'), false)]),
  decryptString: value => {
    if (!value.subarray(0, PREFIX.length).equals(PREFIX)) throw Error('This key format is unsupported. Enter the key again.');
    return dpapi(value.subarray(PREFIX.length), true).toString('utf8');
  }
} : {
  isEncryptionAvailable: () => { try { return require('electron').safeStorage.isEncryptionAvailable(); } catch { return false; } },
  getSelectedStorageBackend: () => require('electron').safeStorage.getSelectedStorageBackend?.(),
  encryptString: value => require('electron').safeStorage.encryptString(value),
  decryptString: value => require('electron').safeStorage.decryptString(value)
};
