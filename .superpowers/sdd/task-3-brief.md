### Task 3: Install creates the workspace and strips the old Hermes watchdog

**Files:**
- Modify: `scripts/install-hijack.ps1`
- Modify: `README.md` only if the watchdog command in the README drifts from the script

**Interfaces:**
- Consumes: `$Workspace = Join-Path $env:USERPROFILE "R1Agent"` (already in install)
- Produces: `Remove-LeftoverHermesWatchdog` called from `Install-Hijack`; does not write `src/config.json`; does not restart rabbit-agent except via existing `Restart-RabbitAgent` at end of install

- [ ] **Step 1: Add watchdog removal (do not restart rabbit-agent here)**

In `scripts/install-hijack.ps1`, after `$TaskName = "R1Wrapper\repair-hijack"`, add:

```powershell
function Remove-LeftoverHermesWatchdog {
  $watchdog = Get-ScheduledTask -TaskName "RabbitR1HermesWatchdog" -ErrorAction SilentlyContinue
  if (-not $watchdog) {
    Write-Host "No leftover Hermes watchdog task"
    return
  }
  Unregister-ScheduledTask -TaskName "RabbitR1HermesWatchdog" -Confirm:$false
  Write-Host "Removed leftover scheduled task: RabbitR1HermesWatchdog"
}
```

Call it from `Install-Hijack` after `Register-RepairTask` and before `Restart-RabbitAgent`.

Do not delete `%LOCALAPPDATA%\hermes\scripts\rabbit_watchdog.py`. Do not edit `src/config.json` from install (custom `cwd` must survive reinstall).

- [ ] **Step 2: Confirm workspace creation still uses USERPROFILE**

`$Workspace` must remain `Join-Path $env:USERPROFILE "R1Agent"`. `New-Item -ItemType Directory -Force -Path $Workspace` already runs at the start of `Install-Hijack`.

- [ ] **Step 3: Manual check (do not run full install on a live session unless the user asks)**

```powershell
Get-ScheduledTask -TaskName "RabbitR1HermesWatchdog" -ErrorAction SilentlyContinue
```

Expected after a user-invoked install on a machine that had the task: empty. Repair task `\R1Wrapper\repair-hijack` still present, Hidden, `-WindowStyle Hidden`.

- [ ] **Step 4: Commit** (only if the user asked)

```powershell
git add scripts/install-hijack.ps1
git commit -m "fix: drop leftover Hermes watchdog on install"
```

---

