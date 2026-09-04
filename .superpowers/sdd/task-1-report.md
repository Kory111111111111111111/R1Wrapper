# Task 1 Report: Default `cwd` is per-user, not koryi

## What you implemented

- Changed shipped `src/config.json` `cwd` from the hardcoded `C:\Users\koryi\R1Agent` to `"%USERPROFILE%\\R1Agent"`.
- Left `logDir` unchanged (`"%LOCALAPPDATA%\\R1Wrapper\\logs"`) and did not modify backend blocks or `loadConfig` logic.
- Added two tests under `describe("loadConfig")` in `test/acp-proxy.test.mjs`:
  - `expands %USERPROFILE% cwd` — writes a temp config with `%USERPROFILE%\\R1Agent`, loads it, and asserts the resolved path equals `join(process.env.USERPROFILE ?? homedir(), "R1Agent")`.
  - `shipped config.json has no hardcoded Users path` — asserts the raw shipped `cwd` string is exactly `%USERPROFILE%\\R1Agent` and does not match a `\\Users\\<name>\\` pattern.
- Added `readFileSync` (`node:fs`) and `homedir` (`node:os`) imports required by the new tests.
- Kept the existing `"loads cursor repo config"` assertion `config.cwd.includes("R1Agent")`.

## What you tested and test results

Command: `node --test test/acp-proxy.test.mjs`

Final result: **35/35 tests pass**, including both new `loadConfig` tests and all existing suites (smoke tests included on this machine).

## TDD Evidence

### RED (before config change)

Command:

```powershell
node --test test/acp-proxy.test.mjs
```

Failing output (excerpt):

```
✖ shipped config.json has no hardcoded Users path (0.7637ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 'C:\\Users\\koryi\\R1Agent'
  - '%USERPROFILE%\\R1Agent'

ℹ tests 35
ℹ pass 34
ℹ fail 1
```

Note: `expands %USERPROFILE% cwd` already passed in RED because `loadConfig` / `expandEnv` already supported `%USERPROFILE%`; only the shipped-config assertion failed as expected.

### GREEN (after config change)

Command:

```powershell
node --test test/acp-proxy.test.mjs
```

Passing output (excerpt):

```
▶ loadConfig
  ✔ loads cursor repo config
  ✔ loads gemini backend without default model
  ✔ throws for unknown backend
  ✔ expands %USERPROFILE% cwd
  ✔ shipped config.json has no hardcoded Users path
✔ loadConfig

ℹ tests 35
ℹ pass 35
ℹ fail 0
```

## Files changed

| File | Change |
|------|--------|
| `src/config.json` | `cwd` → `"%USERPROFILE%\\R1Agent"` |
| `test/acp-proxy.test.mjs` | Added imports + two `loadConfig` tests |

No changes to `src/config.mjs`, README, install scripts, or the plan file.

## Self-review findings

1. **Scope respected** — Only the shipped default `cwd` and tests were touched; no second config format, no install/README edits.
2. **Existing expansion path reused** — `loadConfig` already calls `expandEnv` on `raw.cwd`; no duplicate logic added.
3. **Test fixtures unchanged** — `baseConfig` / `geminiConfig` in tests still use a concrete Windows path for proxy behavior tests; that is intentional and separate from the shipped default.
4. **Raw vs resolved** — The shipped-config test checks the **raw** JSON string (unexpanded), which guards against reintroducing a hardcoded profile path in the repo artifact.
5. **No commit** — Per user instruction, no git commit was made.

## Concerns

- **Existing installs**: Users who already ran `install-hijack.ps1` may still have a copied config with the old hardcoded path on disk until they re-install or repair. That is out of scope for Task 1 but worth noting for later tasks (install script / docs).
- **Test fixture paths**: Several tests still reference `C:\Users\koryi\R1Agent` in mock configs; they remain valid on this dev PC but are not portable. Not introduced by this task; no change requested here.
