#Requires -Version 5.1
<#
.SYNOPSIS
  Report R1Wrapper hijack and proxy health (no secrets or prompt bodies).
#>
$ErrorActionPreference = "Continue"

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath) {
  $env:Path = "$userPath;$env:Path"
}

. (Join-Path $PSScriptRoot "hijack-lib.ps1")

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RepoBin = Join-Path $RepoRoot "bin"
$HermesBin = Join-Path $env:LOCALAPPDATA "hermes\bin"
$ConfigPath = Join-Path $RepoRoot "src\config.json"
$LogFile = Join-Path $env:LOCALAPPDATA "R1Wrapper\logs\acp-proxy.log"
$TaskName = "R1Wrapper\repair-hijack"
$AgentPidFile = Join-Path $env:USERPROFILE ".rabbit-agent\runtime\rabbit-agent.pid"
$AgentStatusFile = Join-Path $env:USERPROFILE ".rabbit-agent\runtime\rabbit-agent.status.json"

Write-Host "=== R1Wrapper status ==="
Write-Host ""

$workspace = Join-Path $env:USERPROFILE "R1Agent"
if (Test-Path $ConfigPath) {
  try {
    $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    if ($cfg.cwd) {
      $workspace = [Environment]::ExpandEnvironmentVariables([string]$cfg.cwd)
      if ($workspace -match '^~(?=$|[\\/])') {
        $workspace = $workspace -replace '^~', $env:USERPROFILE
      }
    }
  } catch {
    Write-Host "config cwd: (parse error)"
  }
}
Write-Host "workspace: $workspace"
Write-Host "config: $ConfigPath"

function Get-CommandVersion([string]$Name) {
  if ($Name -eq "agent") {
    $agentCmd = Join-Path $env:LOCALAPPDATA "cursor-agent\agent.cmd"
    if (Test-Path $agentCmd) {
      $output = & cmd /c "`"$agentCmd`" --version 2>&1" | Select-Object -First 1
      if ($output) {
        return $output.ToString().Trim()
      }
    }
  }

  $output = & cmd /c "$Name --version 2>&1" | Select-Object -First 1
  if ($output -and $output -notmatch "not recognized") {
    return $output.ToString().Trim()
  }
  return $null
}

# Wrappers
if (Test-Path $HermesBin) {
  $integrity = Test-HijackIntegrity $HermesBin $RepoBin
  Write-Host "wrappers: $integrity"
} else {
  Write-Host "wrappers: hermes bin missing ($HermesBin)"
}

# Scheduled task
$task = Get-ScheduledTask -TaskPath "\R1Wrapper\" -TaskName "repair-hijack" -ErrorAction SilentlyContinue
if (-not $task) {
  $task = Get-ScheduledTask -TaskName "R1Wrapper\repair-hijack" -ErrorAction SilentlyContinue
}
if ($task) {
  Write-Host "repair-task: present (state=$($task.State))"
} else {
  Write-Host "repair-task: missing (re-run install-hijack.ps1)"
}

# Config backend
if (Test-Path $ConfigPath) {
  try {
    $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    Write-Host "backend: $($config.backend)"
  } catch {
    Write-Host "backend: config parse error"
  }
} else {
  Write-Host "backend: config missing"
}

# rabbit-agent
if (Test-Path $AgentPidFile) {
  $pidText = (Get-Content $AgentPidFile -Raw).Trim()
  Write-Host "rabbit-agent pid: $pidText"
} else {
  Write-Host "rabbit-agent pid: (no pid file)"
}

if (Test-Path $AgentStatusFile) {
  try {
    $status = Get-Content $AgentStatusFile -Raw | ConvertFrom-Json
    $connected = $status.connected
    if ($null -eq $connected) {
      $connected = $status.status
    }
    Write-Host "rabbit-agent connected: $connected"
  } catch {
    Write-Host "rabbit-agent connected: (status parse error)"
  }
} else {
  Write-Host "rabbit-agent connected: (no status file)"
}

# CLI versions
$agentVersion = Get-CommandVersion "agent"
Write-Host "cursor agent: $(if ($agentVersion) { $agentVersion } else { 'not found' })"

$geminiVersion = Get-CommandVersion "gemini"
Write-Host "gemini cli: $(if ($geminiVersion) { $geminiVersion } else { 'not found' })"

# Gemini auth type (not the key)
$geminiSettings = Join-Path $env:USERPROFILE ".gemini\settings.json"
if (Test-Path $geminiSettings) {
  try {
    $settings = Get-Content $geminiSettings -Raw | ConvertFrom-Json
    $authType = $settings.security.auth.selectedType
    Write-Host "gemini auth type: $(if ($authType) { $authType } else { '(unset)' })"
  } catch {
    Write-Host "gemini auth type: (parse error)"
  }
} else {
  Write-Host "gemini auth type: (no settings)"
}

# Filtered log tail
Write-Host ""
Write-Host "=== recent proxy issues (filtered) ==="
if (Test-Path $LogFile) {
  $pattern = "error|failed|timed out|spawn"
  Get-Content $LogFile -Tail 200 -ErrorAction SilentlyContinue |
    Where-Object { $_ -match $pattern -and $_ -notmatch "session/prompt" } |
    Select-Object -Last 20 |
    ForEach-Object { Write-Host $_ }
  if (-not $?) {
    Write-Host "(none)"
  }
} else {
  Write-Host "(no log file yet)"
}

Write-Host ""
Write-Host "Proxy probe: hermes acp --check"
