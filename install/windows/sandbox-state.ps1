# Explicit, same-machine adoption of an existing native Windows sandbox (setup v5).
# Never provision users, decrypt secrets, copy logs/binaries, or modify the source home.
# Read-only artifacts make native full setup fail BEFORE it resets shared passwords.
function Copy-CodexSandboxState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$SourceHome,
    [Parameter(Mandatory)][string]$DestinationHome,
    [Security.Principal.SecurityIdentifier]$SandboxGroupSid
  )
  $ErrorActionPreference = 'Stop'
  $SourceHome = [IO.Path]::GetFullPath($SourceHome).TrimEnd('\')
  $DestinationHome = [IO.Path]::GetFullPath($DestinationHome).TrimEnd('\')
  if ($SourceHome.Equals($DestinationHome, [StringComparison]::OrdinalIgnoreCase) -or
      $DestinationHome.StartsWith($SourceHome + '\', [StringComparison]::OrdinalIgnoreCase) -or
      $SourceHome.StartsWith($DestinationHome + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Sandbox homes must be separate' }
  if (-not (Test-Path -LiteralPath "$DestinationHome\.codexpp-home.json" -PathType Leaf)) { throw 'Destination is not an initialized private Codex++ home' }
  foreach ($candidate in @($SourceHome,$DestinationHome,"$SourceHome\.sandbox","$SourceHome\.sandbox-secrets","$DestinationHome\.sandbox","$DestinationHome\.sandbox-secrets")) {
    $current = $candidate
    while ($current) {
      if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Sandbox state must not traverse a reparse point' }
      $current = [IO.Path]::GetDirectoryName($current)
    }
  }
  $markerSource = "$SourceHome\.sandbox\setup_marker.json"
  $usersSource = "$SourceHome\.sandbox-secrets\sandbox_users.json"
  foreach ($file in @($markerSource,$usersSource)) {
    $item = Get-Item -LiteralPath $file -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 65536) { throw 'Unsupported sandbox state file' }
  }
  $marker = Get-Content -LiteralPath $markerSource -Raw | ConvertFrom-Json
  if ($marker.version -ne 5 -or $marker.offline_username -ne 'CodexSandboxOffline' -or $marker.online_username -ne 'CodexSandboxOnline') { throw 'Unsupported native sandbox state; expected existing setup v5' }
  if ((Test-Path -LiteralPath "$DestinationHome\.sandbox-secrets") -or
      ((Test-Path -LiteralPath "$DestinationHome\.sandbox") -and @(Get-ChildItem -LiteralPath "$DestinationHome\.sandbox" -Force).Count)) { throw 'Destination already contains sandbox state; refuse to overwrite' }
  if (-not $SandboxGroupSid) { $SandboxGroupSid = ([Security.Principal.NTAccount]::new('CodexSandboxUsers')).Translate([Security.Principal.SecurityIdentifier]) }
  $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($userSid -eq $SandboxGroupSid) { throw 'Sandbox group must not be the current user' }

  function Set-StateAcl([string]$LiteralPath, [bool]$Directory, [bool]$SandboxWritable = $false) {
    $acl = if ($Directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($userSid)
    $inherit = if ($Directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @($userSid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',$inherit,'None','Allow'))
    }
    if ($SandboxWritable) {
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($SandboxGroupSid,'Modify',$inherit,'None','Allow'))
    } else {
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($SandboxGroupSid,'FullControl',$inherit,'None','Deny'))
    }
    Set-Acl -LiteralPath $LiteralPath -AclObject $acl
    if (-not (Get-Acl -LiteralPath $LiteralPath).AreAccessRulesProtected) { throw 'Sandbox ACL protection failed' }
  }

  $markerHash = (Get-FileHash -LiteralPath $markerSource).Hash
  $usersHash = (Get-FileHash -LiteralPath $usersSource).Hash
  $stage = Join-Path $DestinationHome ('.sandbox-adopt-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $stage | Out-Null
  Set-StateAcl $stage $true
  foreach ($dir in @('.sandbox','.sandbox-secrets')) { New-Item -ItemType Directory -Path (Join-Path $stage $dir) | Out-Null }
  Set-StateAcl "$stage\.sandbox" $true $true
  Set-StateAcl "$stage\.sandbox-secrets" $true
  # Copy bytes opaquely into an already protected directory. Do not parse or log credentials.
  Copy-Item -LiteralPath $usersSource -Destination "$stage\.sandbox-secrets\sandbox_users.json"
  Copy-Item -LiteralPath $markerSource -Destination "$stage\.sandbox\setup_marker.json"
  foreach ($file in @("$stage\.sandbox\setup_marker.json","$stage\.sandbox-secrets\sandbox_users.json")) {
    Set-StateAcl $file $false
    [IO.File]::SetAttributes($file, ([IO.File]::GetAttributes($file) -bor [IO.FileAttributes]::ReadOnly))
  }
  if ((Get-FileHash -LiteralPath $usersSource).Hash -ne $usersHash -or
      (Get-FileHash -LiteralPath $markerSource).Hash -ne $markerHash -or
      (Get-FileHash -LiteralPath "$stage\.sandbox-secrets\sandbox_users.json").Hash -ne $usersHash -or
      (Get-FileHash -LiteralPath "$stage\.sandbox\setup_marker.json").Hash -ne $markerHash) { throw 'Sandbox source changed during adoption; protected staging retained, not activated' }
  # Both targets are explicit descendants of the validated private home; never recursive-delete.
  if (Test-Path -LiteralPath "$DestinationHome\.sandbox") { [IO.Directory]::Delete("$DestinationHome\.sandbox", $false) }
  Move-Item -LiteralPath "$stage\.sandbox-secrets" -Destination "$DestinationHome\.sandbox-secrets"
  Move-Item -LiteralPath "$stage\.sandbox" -Destination "$DestinationHome\.sandbox"
  [IO.Directory]::Delete($stage, $false)
  [pscustomobject]@{ Adopted=$true; SetupVersion=5; SourceUnchanged=$true; ReprovisionGuard='read-only marker and credentials'; NativeExecutionVerified=$false }
}
