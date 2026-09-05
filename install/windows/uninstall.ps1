# Codex++ uninstaller for Windows.
#
# Removes the patched app copy and its shortcuts. The private user data dir
# (accounts, usage cache, auth backups) is kept — delete it manually for a
# clean slate.

[CmdletBinding()]
param(
  [string]$DestDir = "$env:LOCALAPPDATA\Programs\CodexPP",
  [string]$DataDir = "$env:LOCALAPPDATA\CodexPP",
  [string]$AppName = "Codex++",
  [switch]$KeepClaudePeers
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path

function Info($msg) { Write-Host "==> $msg" }

Info "removing: $DestDir"
if (Test-Path $DestDir) { Remove-Item $DestDir -Recurse -Force }

if (-not $KeepClaudePeers) {
  $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { "$env:USERPROFILE\.codex" }
  & node "$RepoRoot\integrations\claude-peers\install.mjs" --codex-home $codexHome --remove
}

$targets = @(
  (Join-Path ([Environment]::GetFolderPath("Programs")) "$AppName.lnk"),
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "$AppName.lnk")
)
foreach ($t in $targets) {
  if (Test-Path $t) { Info "removing: $t"; Remove-Item $t -Force }
}

Write-Host "note: $DataDir was kept (accounts and auth backups live there)."
