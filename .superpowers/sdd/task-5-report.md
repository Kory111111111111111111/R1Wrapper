# Task 5 Report: README matches the portable default

## Status

DONE

## Changes

No edits required. `README.md` already matches shipped `src/config.json`:

| Requirement | README location | Value |
|---|---|---|
| `cwd` example | Config section JSON snippet | `"cwd": "%USERPROFILE%\\R1Agent"` |
| Portable wording | Line 56 | "You can also set a full path if you want the workspace somewhere else." |
| No hardcoded username | Entire file | No `koryi`; migration hint uses `C:\Users\<someone>\R1Agent` |
| Single config file | Config section | Only `src/config.json` documented |

Cross-check against `src/config.json` line 5: both use `"%USERPROFILE%\\R1Agent"`.

Other portable references already present: install step creates `%USERPROFILE%\R1Agent`; logs section clarifies workspace is `%USERPROFILE%\R1Agent`.

## Verification

Ran:

```powershell
npm test
```

Result: **37 pass, 0 fail**.

## Commits

None (per instructions).

## Concerns

None.
