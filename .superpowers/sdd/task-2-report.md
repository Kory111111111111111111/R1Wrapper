# Task 2 Report: Missing cwd still lands in the current user's R1Agent

## Status

DONE

## Summary

Added the omitted-`cwd` regression test to `test/acp-proxy.test.mjs`. Existing `loadConfig` fallback (`raw.cwd ?? join(homedir(), "R1Agent")`) already satisfies the requirement; no changes to `src/config.mjs` were required.

## Changes

| File | Change |
|------|--------|
| `test/acp-proxy.test.mjs` | Added `it("defaults omitted cwd to homedir R1Agent", ...)` in the `loadConfig` describe block |
| `src/config.mjs` | Unchanged |
| `src/config.json` | Unchanged (per task constraints) |

## Test

```text
node --test test/acp-proxy.test.mjs
```

Result: **36 pass, 0 fail** (includes new test `defaults omitted cwd to homedir R1Agent`).

## Verification

- Config without `cwd` resolves to `join(homedir(), "R1Agent")` after `expandEnv`.
- No `R1WRAPPER_CWD` added.
- Shipped `config.json` and other loadConfig tests unaffected.

## Commits

None (per task instructions).
