#Requires -Version 5.1
# Shared Hermes hijack helpers for install and repair scripts.

$script:HijackMarker = "r1wrapper-hijack"

function Get-HijackMarker {
  return $script:HijackMarker
}

function Get-HijackWrapperContent([string]$RepoBinFile) {
  return "@echo off`r`nrem $script:HijackMarker`r`ncall `"$RepoBinFile`" %*`r`nexit /b %ERRORLEVEL%`r`n"
}

function Test-HijackWrapperFile([string]$WrapperPath, [string]$ExpectedRepoBinFile) {
  if (-not (Test-Path $WrapperPath)) {
    return "missing"
  }

  if (-not (Test-Path $ExpectedRepoBinFile)) {
    return "error"
  }

  $content = Get-Content -Path $WrapperPath -Raw -ErrorAction SilentlyContinue
  if ([string]::IsNullOrWhiteSpace($content)) {
    return "drifted"
  }

  if ($content -notmatch [regex]::Escape("rem $script:HijackMarker")) {
    return "drifted"
  }

  $expectedCall = "call `"$ExpectedRepoBinFile`""
  if ($content -notmatch [regex]::Escape($expectedCall)) {
    return "drifted"
  }

  return "ok"
}

function Test-HijackIntegrity([string]$HermesBin, [string]$RepoBin) {
  $targets = @("hermes.cmd", "hermes-acp.cmd")
  foreach ($name in $targets) {
    $wrapperPath = Join-Path $HermesBin $name
    $repoBinFile = Join-Path $RepoBin $name
    $state = Test-HijackWrapperFile $wrapperPath $repoBinFile
    if ($state -ne "ok") {
      return $state
    }
  }
  return "ok"
}

function Write-HijackWrapperAtomic([string]$WrapperPath, [string]$Content) {
  $parent = Split-Path -Parent $WrapperPath
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  $tempPath = "$WrapperPath.tmp"
  Set-Content -Path $tempPath -Value $Content -Encoding ASCII -NoNewline
  Move-Item -Path $tempPath -Destination $WrapperPath -Force
}

function Install-HijackWrappers([string]$HermesBin, [string]$RepoBin, [switch]$Quiet) {
  if (-not (Test-Path $RepoBin)) {
    throw "Repo bin directory not found: $RepoBin"
  }

  $changed = $false
  $targets = @("hermes.cmd", "hermes-acp.cmd")
  foreach ($name in $targets) {
    $repoBinFile = Join-Path $RepoBin $name
    if (-not (Test-Path $repoBinFile)) {
      throw "Missing repo launcher: $repoBinFile"
    }

    $wrapperPath = Join-Path $HermesBin $name
    $state = Test-HijackWrapperFile $wrapperPath $repoBinFile
    if ($state -eq "ok") {
      if (-not $Quiet) {
        Write-Host "Wrapper ok: $wrapperPath"
      }
      continue
    }

    $content = Get-HijackWrapperContent $repoBinFile
    Write-HijackWrapperAtomic $wrapperPath $content
    $changed = $true
    if (-not $Quiet) {
      Write-Host "Repaired wrapper: $wrapperPath"
    }
  }

  return $changed
}

function Backup-HijackWrapperIfNeeded([string]$Path) {
  $backup = "$Path.pre-r1wrapper"
  if ((Test-Path $Path) -and -not (Test-Path $backup)) {
    Copy-Item -Path $Path -Destination $backup -Force
    Write-Host "Backed up $Path -> $backup"
  }
}
