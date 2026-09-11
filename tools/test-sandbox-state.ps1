$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\install\windows\sandbox-state.ps1"
$root = Join-Path ([IO.Path]::GetTempPath()) ('codexpp-sandbox-contract-' + [Guid]::NewGuid().ToString('N'))
$source = Join-Path $root 'source'
$target = Join-Path $root 'private'
New-Item -ItemType Directory -Path "$source\.sandbox","$source\.sandbox-secrets",$target -Force | Out-Null
# Only synthetic opaque data; this contract test never reads a real credential store.
[IO.File]::WriteAllText("$source\.sandbox\setup_marker.json", '{"version":5,"offline_username":"CodexSandboxOffline","online_username":"CodexSandboxOnline","proxy_ports":[],"allow_local_binding":false}')
[IO.File]::WriteAllText("$source\.sandbox-secrets\sandbox_users.json", 'opaque-fixture-not-a-credential')
[IO.File]::WriteAllText("$target\.codexpp-home.json", '{"version":1}')
$sourceHash = (Get-FileHash -LiteralPath "$source\.sandbox-secrets\sandbox_users.json").Hash
$group = [Security.Principal.SecurityIdentifier]::new('S-1-5-21-111111111-222222222-333333333-1017')
Copy-CodexSandboxState -SourceHome $source -DestinationHome $target -SandboxGroupSid $group | Out-Null
if ((Get-FileHash -LiteralPath "$target\.sandbox-secrets\sandbox_users.json").Hash -ne $sourceHash) { throw 'Opaque state copy mismatch' }
if ((Get-FileHash -LiteralPath "$source\.sandbox-secrets\sandbox_users.json").Hash -ne $sourceHash) { throw 'Source changed' }
foreach ($file in @("$target\.sandbox\setup_marker.json", "$target\.sandbox-secrets\sandbox_users.json")) {
  if (-not (Get-Acl -LiteralPath $file).AreAccessRulesProtected) { throw 'State file inherited permissions' }
  if (-not ((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReadOnly)) { throw 'Provisioning guard missing' }
  $deleted = $false
  try { [IO.File]::Delete($file); $deleted = $true } catch [UnauthorizedAccessException] { }
  if ($deleted) { throw 'Native DeleteFile can bypass the no-reprovision guard' }
}
$refused = $false
try { Copy-CodexSandboxState -SourceHome $source -DestinationHome $target -SandboxGroupSid $group | Out-Null } catch { $refused = $_.Exception.Message -match 'already contains' }
if (-not $refused) { throw 'Existing private state was not refused' }
$fresh = Join-Path $root 'incompatible'
New-Item -ItemType Directory -Path $fresh | Out-Null
[IO.File]::WriteAllText("$fresh\.codexpp-home.json", '{}')
[IO.File]::WriteAllText("$source\.sandbox\setup_marker.json", '{"version":99}')
$refused = $false
try { Copy-CodexSandboxState -SourceHome $source -DestinationHome $fresh -SandboxGroupSid $group | Out-Null } catch { $refused = $_.Exception.Message -match 'Unsupported' }
if (-not $refused -or (Test-Path -LiteralPath "$fresh\.sandbox")) { throw 'Unsupported state was imported' }
Write-Output 'PASS: opaque copy, unchanged source, protected ACLs, read-only delete guard, duplicate refusal, incompatible version refusal (6 checks)'
Write-Output "Synthetic fixture retained at $root"
