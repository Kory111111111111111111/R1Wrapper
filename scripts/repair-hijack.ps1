#Requires -Version 5.1
<#
.SYNOPSIS
  Repair drifted Hermes hijack wrappers without restarting rabbit-agent.

.PARAMETER Check
  Exit 0 if ok, 2 if drifted, 1 on error. Does not repair.

.PARAMETER RepoRoot
  Override repo root (for testing).

.PARAMETER HermesBin
  Override Hermes bin directory (for testing).
#>
param(
  [switch]$Check,
  [string]$RepoRoot,
  [string]$HermesBin
)

$ErrorActionPreference = "Stop"

$mutexName = "Global\R1WrapperRepairHijack"
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$acquired = $false

try {
  $acquired = $mutex.WaitOne(0)
  if (-not $acquired) {
    if ($Check) {
      exit 0
    }
    Write-Host "Another repair instance is running; exiting."
    exit 0
  }

  . (Join-Path $PSScriptRoot "hijack-lib.ps1")

  if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent $PSScriptRoot
  }
  if (-not $HermesBin) {
    $HermesBin = Join-Path $env:LOCALAPPDATA "hermes\bin"
  }

  $RepoBin = Join-Path $RepoRoot "bin"

  if (-not (Test-Path $HermesBin)) {
    Write-Error "Hermes bin directory not found: $HermesBin"
    exit 1
  }

  $integrity = Test-HijackIntegrity $HermesBin $RepoBin

  if ($Check) {
    switch ($integrity) {
      "ok" { exit 0 }
      "drifted" { exit 2 }
      default { exit 1 }
    }
  }

  if ($integrity -eq "ok") {
    Write-Host "Hijack wrappers ok."
    exit 0
  }

  $changed = Install-HijackWrappers -HermesBin $HermesBin -RepoBin $RepoBin
  if ($changed) {
    Write-Host "Wrappers repaired. Start a new R1 session (or re-run install-hijack.ps1) to pick up the fix."
  } else {
    Write-Host "No wrapper changes were needed."
  }
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($acquired) {
    $mutex.ReleaseMutex() | Out-Null
  }
  $mutex.Dispose()
}
