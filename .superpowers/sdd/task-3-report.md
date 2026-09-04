# Task 3 Report: Install creates workspace and strips Hermes watchdog

**Status:** DONE  
**Date:** 2026-09-04

## Summary

Added `Remove-LeftoverHermesWatchdog` to `scripts/install-hijack.ps1` per the task brief. Install now unregisters the legacy `\RabbitR1HermesWatchdog` scheduled task (if present) after registering the repair task and before restarting rabbit-agent.

## Changes

### `scripts/install-hijack.ps1`

1. **Added `Remove-LeftoverHermesWatchdog`** immediately after `$TaskName = "R1Wrapper\repair-hijack"`:
   - Looks up `RabbitR1HermesWatchdog` with `Get-ScheduledTask -ErrorAction SilentlyContinue`
   - If absent: logs `No leftover Hermes watchdog task` and returns
   - If present: `Unregister-ScheduledTask -TaskName "RabbitR1HermesWatchdog" -Confirm:$false` and logs removal

2. **Wired into `Install-Hijack`** after `Register-RepairTask | Out-Null` and before `Restart-RabbitAgent`

### Unchanged (verified)

- `$Workspace` remains `Join-Path $env:USERPROFILE "R1Agent"`
- `New-Item -ItemType Directory -Force -Path $Workspace` still runs at the start of `Install-Hijack`
- `src/config.json` not touched
- `rabbit_watchdog.py` not deleted
- `README.md` not edited — watchdog command already matches script (`Unregister-ScheduledTask -TaskName "RabbitR1HermesWatchdog" -Confirm:$false`)

## Manual checks (read-only)

```powershell
Get-ScheduledTask -TaskName "RabbitR1HermesWatchdog" -ErrorAction SilentlyContinue
```

**Result:** No task on this machine (empty output). Expected when watchdog was already removed or never installed.

Full install was **not** run (would restart rabbit-agent and kill a live R1 session).

## Commit

None — per task instructions.

## Concerns

None. Removal is idempotent and only affects the legacy watchdog task; repair task registration and rabbit-agent restart behavior are unchanged aside from the new cleanup step ordering.
