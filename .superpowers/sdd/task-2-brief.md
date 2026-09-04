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

