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
