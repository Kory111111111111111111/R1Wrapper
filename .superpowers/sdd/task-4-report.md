# Task 4 Report: Status prints the resolved workspace

## Status

DONE

## Changes

Modified `scripts/status.ps1` to expand and print the configured workspace path after the status header.

Added block after `=== R1Wrapper status ===` (once `$ConfigPath` is set):

- Default workspace: `Join-Path $env:USERPROFILE "R1Agent"`
- If `src/config.json` exists and parses, uses `cwd` with `[Environment]::ExpandEnvironmentVariables`
- On parse error, prints `config cwd: (parse error)` and keeps default
- Prints `workspace: <absolute path>` and `config: <ConfigPath>`

## Verification

Ran:

```powershell
.\scripts\status.ps1
```

Relevant output:

```
=== R1Wrapper status ===

workspace: C:\Users\koryi\R1Agent
config: C:\Users\koryi\Desktop\APPS\R1Wrapper\src\config.json
```

- `workspace:` expands `%USERPROFILE%\R1Agent` from shipped `src/config.json` to the current user's absolute path.
- `config:` points at repo `src\config.json`.
- No proxy log bodies or secrets printed beyond existing filtered tail behavior.

## Commits

None (per instructions).

## Concerns

None.
