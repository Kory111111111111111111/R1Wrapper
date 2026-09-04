### Task 4: Status prints the resolved workspace

**Files:**
- Modify: `scripts/status.ps1`

**Interfaces:**
- Consumes: `src/config.json` `cwd` string (may contain `%USERPROFILE%`)
- Produces: stdout line `workspace: <absolute path>` with env vars expanded

- [ ] **Step 1: Expand and print cwd**

After the existing `=== R1Wrapper status ===` header block, once `$ConfigPath` is set, add:

```powershell
$workspace = Join-Path $env:USERPROFILE "R1Agent"
if (Test-Path $ConfigPath) {
  try {
    $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    if ($cfg.cwd) {
      $workspace = [Environment]::ExpandEnvironmentVariables([string]$cfg.cwd)
    }
  } catch {
    Write-Host "config cwd: (parse error)"
  }
}
Write-Host "workspace: $workspace"
Write-Host "config: $ConfigPath"
```

Do not print proxy log bodies or secrets.

- [ ] **Step 2: Run**

```powershell
.\scripts\status.ps1
```

Expected: a `workspace:` line under the current user, not `C:\Users\koryi\R1Agent` unless that is this user.

- [ ] **Step 3: Commit** (only if the user asked)

---

