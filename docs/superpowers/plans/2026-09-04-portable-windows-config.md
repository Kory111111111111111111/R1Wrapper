# Portable Windows Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship R1Wrapper so any Windows user can clone, run `scripts/install-hijack.ps1`, and get a working hijack without editing `C:\Users\koryi\...` paths.

**Architecture:** Keep a single committed `src/config.json`. Stop baking a username into `cwd`. Expand `%USERPROFILE%` / `%LOCALAPPDATA%` (already implemented in `loadConfig`) and default missing `cwd` to `~/R1Agent`. Install creates that folder and does not overwrite a custom `cwd`. Optional leftover `\RabbitR1HermesWatchdog` is removed at install so old Hermes setups cannot restart rabbit-agent.

**Tech Stack:** Node 20+ ESM (`src/config.mjs`), PowerShell 5.1 (`scripts/install-hijack.ps1`, `scripts/status.ps1`), `node --test`.

## Global Constraints

- Windows-only hijack; do not add macOS/Linux installers.
- Do not put API keys, tokens, or Gemini/Cursor credentials in `src/config.json` or README.
- Agent on the R1 may change only the top-level `"backend"` field (`cursor` | `gemini`); do not teach it to rewrite `cwd`.
- Repair scheduled task must stay hidden and must never restart rabbit-agent.
- Do not edit this plan file while implementing.
- Keep `cwd` expansion in `loadConfig`; do not add a second config format or `config.local.json` unless a later task requires it (YAGNI: one file).

## File map

- `src/config.json` — committed defaults; `cwd` must be `%USERPROFILE%\R1Agent`.
- `src/config.mjs` — already expands `%VAR%` and `~`; add tests, no new env var unless a test proves `expandEnv` misses `USERPROFILE`.
- `scripts/install-hijack.ps1` — create workspace; warn/remove leftover Hermes watchdog; do not rewrite custom `cwd`.
- `scripts/status.ps1` — print resolved workspace path.
- `test/acp-proxy.test.mjs` — expansion + no-username-in-shipped-config tests; fixture configs may keep literal paths.
- `README.md` — already added; update the cwd snippet if the default string changes.

---

### Task 1: Default `cwd` is per-user, not koryi

**Files:**
- Modify: `src/config.json`
- Modify: `test/acp-proxy.test.mjs` (loadConfig describe)
- Test: `test/acp-proxy.test.mjs`

**Interfaces:**
- Consumes: `loadConfig(path)` in `src/config.mjs` (`expandEnv` already replaces `%USERPROFILE%`)
- Produces: shipped `cwd` string `"%USERPROFILE%\\R1Agent"`; resolved absolute path under the current user's profile

- [ ] **Step 1: Write the failing tests**

In `test/acp-proxy.test.mjs` inside `describe("loadConfig")`, add:

```js
it("expands %USERPROFILE% cwd", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "r1wrapper-config-"));
  const configPath = join(tmpDir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      backend: "cursor",
      cwd: "%USERPROFILE%\\R1Agent",
      cursor: { command: "agent", args: ["acp"] },
    }),
    "utf8",
  );
  const config = loadConfig(configPath);
  assert.equal(config.cwd, join(process.env.USERPROFILE ?? homedir(), "R1Agent"));
  rmSync(tmpDir, { recursive: true, force: true });
});

it("shipped config.json has no hardcoded Users path", () => {
  const raw = JSON.parse(readFileSync(join(repoRoot, "src", "config.json"), "utf8"));
  assert.equal(raw.cwd, "%USERPROFILE%\\R1Agent");
  assert.equal(/\\\\Users\\\\[^\\]+\\\\/i.test(String(raw.cwd)), false);
});
```

Add `readFileSync` and `homedir` imports if missing (`node:fs`, `node:os`). Keep existing `"loads cursor repo config"` assertion `config.cwd.includes("R1Agent")`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/acp-proxy.test.mjs`

Expected: FAIL on `shipped config.json has no hardcoded Users path` (current value is `C:\\Users\\koryi\\R1Agent`).

- [ ] **Step 3: Change shipped cwd**

`src/config.json`:

```json
"cwd": "%USERPROFILE%\\R1Agent",
```

Leave `logDir` as `"%LOCALAPPDATA%\\R1Wrapper\\logs"`. Do not change backend blocks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/acp-proxy.test.mjs`

Expected: PASS, including the new loadConfig tests.

- [ ] **Step 5: Commit** (only if the user asked to commit)

```powershell
git add src/config.json test/acp-proxy.test.mjs
git commit -m "fix: default R1 workspace to %USERPROFILE%\\R1Agent"
```

---

### Task 2: Missing cwd still lands in the current user's R1Agent

**Files:**
- Modify: `src/config.mjs` only if tests fail (current fallback is `join(homedir(), "R1Agent")`)
- Modify: `test/acp-proxy.test.mjs`

**Interfaces:**
- Consumes: `loadConfig` line `cwd = expandEnv(String(raw.cwd ?? join(homedir(), "R1Agent")))`
- Produces: omitted `cwd` resolves to `join(homedir(), "R1Agent")`

- [ ] **Step 1: Write the failing test**

```js
it("defaults omitted cwd to homedir R1Agent", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "r1wrapper-config-"));
  const configPath = join(tmpDir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      backend: "cursor",
      cursor: { command: "agent", args: ["acp"] },
    }),
    "utf8",
  );
  const config = loadConfig(configPath);
  assert.equal(config.cwd, join(homedir(), "R1Agent"));
  rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test**

Run: `node --test test/acp-proxy.test.mjs`

Expected: PASS already if `loadConfig` fallback is intact. If FAIL, restore the `raw.cwd ?? join(homedir(), "R1Agent")` fallback. Do not add `R1WRAPPER_CWD`.

- [ ] **Step 3: Commit** (only if the user asked and this task changed files)

---

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

### Task 5: README matches the portable default

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 shipped `cwd` value
- Produces: README `cwd` example is `%USERPROFILE%\R1Agent`; no `koryi` as a required username

- [ ] **Step 1: Align the config snippet**

If `src/config.json` `cwd` is `%USERPROFILE%\R1Agent`, the README config section must show that same string. Keep the "or put a full path" sentence. Do not add a second config file.

- [ ] **Step 2: Run tests once more**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Commit** (only if the user asked)
