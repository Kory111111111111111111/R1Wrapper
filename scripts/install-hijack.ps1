#Requires -Version 5.1
<#
.SYNOPSIS
  Install R1Wrapper Hermes ACP hijack on this Windows machine.

.DESCRIPTION
  - Backs up %LOCALAPPDATA%\hermes\bin\hermes*.cmd
  - Replaces them with marker wrappers that call this repo's bin\hermes*.cmd
  - Prepends this repo's bin\ to the user PATH
  - Registers a scheduled task to repair drifted wrappers (does not restart rabbit-agent)
  - Creates the R1Agent workspace directory
  - Restarts rabbit-agent if running (install only; repair task never restarts)
#>
param(
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "hijack-lib.ps1")

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RepoBin = Join-Path $RepoRoot "bin"
$HermesBin = Join-Path $env:LOCALAPPDATA "hermes\bin"
$Workspace = Join-Path $env:USERPROFILE "R1Agent"
$LogDir = Join-Path $env:LOCALAPPDATA "R1Wrapper\logs"
$RepairScript = Join-Path $PSScriptRoot "repair-hijack.ps1"
$TaskName = "R1Wrapper\repair-hijack"

function Register-RepairTask {
  if (-not (Test-Path $RepairScript)) {
    Write-Host "Repair script not found; skipping scheduled task registration."
    return $false
  }

  try {
    $action = New-ScheduledTaskAction `
      -Execute "powershell.exe" `
      -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RepairScript`""

    $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $periodicTrigger = New-ScheduledTaskTrigger `
      -Once `
      -At (Get-Date).Date `
      -RepetitionInterval (New-TimeSpan -Minutes 10) `
      -RepetitionDuration (New-TimeSpan -Days 3650)

    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -MultipleInstances IgnoreNew `
      -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
      -Hidden

    Register-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger @($logonTrigger, $periodicTrigger) `
      -Settings $settings `
      -Force | Out-Null

    Write-Host "Registered scheduled task: $TaskName"
    return $true
  } catch {
    Write-Host "Could not register scheduled task: $($_.Exception.Message)"
    Write-Host "Install continues; re-run install or register the task manually."
    return $false
  }
}

function Unregister-RepairTask {
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    Write-Host "Removed scheduled task: $TaskName"
  } catch {
    Write-Host "Scheduled task not found or already removed: $TaskName"
  }
}

function Install-Hijack {
  if (-not (Test-Path (Join-Path $RepoBin "hermes.cmd"))) {
    throw "Missing repo launcher: $(Join-Path $RepoBin 'hermes.cmd')"
  }

  New-Item -ItemType Directory -Force -Path $Workspace | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Write-Host "Workspace: $Workspace"
  Write-Host "Logs: $LogDir"

  if (-not (Test-Path $HermesBin)) {
    throw "Hermes bin directory not found: $HermesBin"
  }

  $targets = @("hermes.cmd", "hermes-acp.cmd")
  foreach ($name in $targets) {
    $target = Join-Path $HermesBin $name
    Backup-HijackWrapperIfNeeded $target
  }

  Install-HijackWrappers -HermesBin $HermesBin -RepoBin $RepoBin | Out-Null

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$RepoBin*") {
    $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $RepoBin } else { "$RepoBin;$userPath" }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$RepoBin;$env:Path"
    Write-Host "Prepended user PATH: $RepoBin"
  } else {
    Write-Host "User PATH already contains repo bin"
  }

  $cursorAgent = Join-Path $env:LOCALAPPDATA "cursor-agent"
  if ($env:Path -notlike "*$cursorAgent*") {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$cursorAgent*") {
      $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $cursorAgent } else { "$cursorAgent;$userPath" }
      [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
      $env:Path = "$cursorAgent;$env:Path"
      Write-Host "Prepended user PATH: $cursorAgent"
    }
  }

  Register-RepairTask | Out-Null

  Restart-RabbitAgent
  Write-Host ""
  Write-Host "Install complete. Test with:"
  Write-Host "  hermes acp --check"
  Write-Host "  hermes acp --version"
  Write-Host "  .\scripts\status.ps1"
  Write-Host ""
  Write-Host "Then on the R1: Hermes page -> PTT a short phrase."
}

function Uninstall-Hijack {
  Unregister-RepairTask

  $targets = @("hermes.cmd", "hermes-acp.cmd")
  foreach ($name in $targets) {
    $target = Join-Path $HermesBin $name
    $backup = "$target.pre-r1wrapper"
    if (Test-Path $backup) {
      Move-Item -Path $backup -Destination $target -Force
      Write-Host "Restored $target from backup"
    }
  }

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $segments = $userPath -split ';' | Where-Object { $_ -and ($_ -ne $RepoBin) }
  [Environment]::SetEnvironmentVariable("Path", ($segments -join ';'), "User")
  Write-Host "Removed repo bin from user PATH (if present)"
  Restart-RabbitAgent
  Write-Host "Uninstall complete."
}

function Restart-RabbitAgent {
  $pidFile = Join-Path $env:USERPROFILE ".rabbit-agent\runtime\rabbit-agent.pid"
  if (-not (Test-Path $pidFile)) {
    Write-Host "rabbit-agent pid file not found; skip restart"
    return
  }

  $agentPid = (Get-Content $pidFile -Raw).Trim()
  if ($agentPid -match '^\d+$') {
    try {
      Stop-Process -Id ([int]$agentPid) -Force -ErrorAction Stop
      Write-Host "Stopped rabbit-agent pid $agentPid"
      Start-Sleep -Seconds 2
    } catch {
      Write-Host "Could not stop rabbit-agent pid ${agentPid}: $($_.Exception.Message)"
    }
  }

  $agentExe = Join-Path $env:USERPROFILE ".rabbit-agent\bin\rabbit-agent.exe"
  if (Test-Path $agentExe) {
    Start-Process -FilePath $agentExe -ArgumentList "run" -WindowStyle Hidden
    Write-Host "Started rabbit-agent"
  } else {
    Write-Host "rabbit-agent binary not found; restart manually"
  }
}

if ($Uninstall) {
  Uninstall-Hijack
} else {
  Install-Hijack
}
