# Codex++ installer for Windows.
#
# Copies the MSIX-installed Codex desktop app to a writable per-user folder,
# patches its app.asar (same patches as the macOS build) and creates Start
# Menu / Desktop shortcuts that point the app at a private user data dir.
#
# Usage:  powershell -ExecutionPolicy Bypass -File install\windows\install.ps1
#         install\windows\install.ps1 -SrcApp "D:\CodexApp" -DestDir "E:\CodexPP"

[CmdletBinding()]
param(
  # Folder that contains ChatGPT.exe and resources\ (the MSIX "app" payload).
  # Default: resolved from the store-installed OpenAI.Codex package.
  [string]$SrcApp = "",
  [string]$DestDir = "$env:LOCALAPPDATA\Programs\CodexPP",
  # Electron userData dir, passed to the app with --user-data-dir.
  [string]$DataDir = "$env:LOCALAPPDATA\CodexPP",
  [string]$AppName = "Codex++",
  [switch]$NoDesktopShortcut,
  [switch]$AllowUntestedSource,
  [switch]$SkipClaudePeers
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$DataDir = [IO.Path]::GetFullPath($DataDir)

function Info($msg) { Write-Host "==> $msg" }
function Die($msg)  { Write-Host "error: $msg" -ForegroundColor Red; exit 1 }

function Resolve-SourceApp {
  $pkg = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction SilentlyContinue |
    Sort-Object -Property Version -Descending | Select-Object -First 1
  if ($pkg) {
    Info "source package: OpenAI.Codex $($pkg.Version)"
  }
  if ($SrcApp) {
    if (-not (Test-Path "$SrcApp\resources\app.asar")) {
      Die "no resources\app.asar under: $SrcApp"
    }
    Info "source folder: $SrcApp"
    return $SrcApp
  }
  if (-not $pkg) {
    Die "store package OpenAI.Codex not found. Install the Codex desktop app first, or pass -SrcApp <folder with ChatGPT.exe>."
  }
  $app = Join-Path $pkg.InstallLocation "app"
  if (-not (Test-Path "$app\resources\app.asar")) {
    Die "unexpected package layout, no app\resources\app.asar under $($pkg.InstallLocation)"
  }
  Info "source: OpenAI.Codex $($pkg.Version) -> $app"
  return $app
}

function Backup-ExistingApp {
  if (Test-Path $DestDir) {
    $ts = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmssZ")
    $backupDir = Join-Path $DataDir "backups"
    $backupTarget = Join-Path $backupDir "CodexPP-$ts"
    Info "backing up existing app -> $backupTarget"
    if (-not (Test-Path $backupDir)) {
      New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    }
    Move-Item -Path $DestDir -Destination $backupTarget
  }
}

function Copy-App {
  Backup-ExistingApp
  Info "copying -> $DestDir"
  # robocopy: 0-7 are success, anything else is a real failure
  robocopy $SrcApp $DestDir /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Die "robocopy failed with exit code $LASTEXITCODE" }
}

function Invoke-Patch {
  Info "patching asar"
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Die "node not found. Node.js required: https://nodejs.org"
  }
  Info "installing locked patch dependencies"
  Push-Location "$RepoRoot\patch"
  try { npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { Die "npm ci failed" } }
  finally { Pop-Location }
  $patchArgs = @(
    "$RepoRoot\patch\apply.mjs",
    "--src", "$SrcApp\resources\app.asar",
    "--out", "$DestDir\resources\app.asar"
  )
  if ($AllowUntestedSource) {
    $patchArgs += "--allow-untested-source"
  }
  & node @patchArgs
  if ($LASTEXITCODE -ne 0) { Die "patching failed" }
  & node "$RepoRoot\patch\windows-integrity.mjs" "$DestDir\ChatGPT.exe" "$SrcApp\resources\app.asar" "$DestDir\resources\app.asar"
  if ($LASTEXITCODE -ne 0) { Die "Windows ASAR integrity update failed" }
}

function Install-Hub {
  Info "installing locked hub dependencies"
  Push-Location "$RepoRoot\hub"
  try { npm ci --omit=dev --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { Die "hub npm ci failed" } }
  finally { Pop-Location }
  Info "copying hub"
  $hub = "$DestDir\resources\hub"
  if (Test-Path $hub) { Remove-Item $hub -Recurse -Force }
  Copy-Item "$RepoRoot\hub" $hub -Recurse
  Copy-Item -LiteralPath "$RepoRoot\THIRD_PARTY_NOTICES.md" -Destination "$hub\THIRD_PARTY_NOTICES.md"
}

function Install-ClaudePeers {
  if ($SkipClaudePeers) {
    Info "skipping claude-peers (-SkipClaudePeers)"
    return
  }
  Info "registering claude-peers MCP server"
  $codexHome = Join-Path $DataDir 'codex-home'
  & node "$RepoRoot\integrations\claude-peers\install.mjs" --codex-home $codexHome
  if ($LASTEXITCODE -ne 0) {
    Write-Host "    ! claude-peers registration failed, continuing" -ForegroundColor Yellow
  }
}

function New-Shortcut([string]$Path) {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut($Path)
  $lnk.TargetPath = "$DestDir\ChatGPT.exe"
  $lnk.Arguments = "--user-data-dir=`"$DataDir`""
  $lnk.WorkingDirectory = $DestDir
  $lnk.IconLocation = "$DestDir\ChatGPT.exe,0"
  $lnk.Description = $AppName
  $lnk.Save()
}

function Install-Shortcuts {
  Info "creating shortcuts"
  $startMenu = [Environment]::GetFolderPath("Programs")
  New-Shortcut (Join-Path $startMenu "$AppName.lnk")
  if (-not $NoDesktopShortcut) {
    $desktop = [Environment]::GetFolderPath("Desktop")
    New-Shortcut (Join-Path $desktop "$AppName.lnk")
  }
}

$SrcApp = Resolve-SourceApp
$entry = "$DestDir\ChatGPT.exe"
if (-not (Test-Path "$SrcApp\ChatGPT.exe")) {
  Die "ChatGPT.exe not found in $SrcApp (unexpected layout)"
}

Copy-App
Invoke-Patch
Install-Hub
& node "$RepoRoot\hub\home.cjs" $DataDir
if ($LASTEXITCODE -ne 0) { Die "private CODEX_HOME initialization failed" }
Install-ClaudePeers
Install-Shortcuts

Write-Host ""
Write-Host "  install complete"
Write-Host ""
Write-Host "  app        : $DestDir"
Write-Host "  user data  : $DataDir  (private; the store app keeps its own)"
Write-Host "  CODEX_HOME : $DataDir\codex-home  (private; original CLI settings are preserved)"
if (-not $SkipClaudePeers) {
  Write-Host "  claude-peers: $DataDir\codex-home\mcp\claude-peers  (Claude sessions as Codex tools)"
}
Write-Host ""
Write-Host "  start it from the Start Menu (`"$AppName`")"
Write-Host "  after a store update re-run this script to refresh the copy"
