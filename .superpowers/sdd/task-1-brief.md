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

