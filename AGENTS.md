## Learned User Preferences

- Default R1/Cursor backend model is Composer 2.5 with fast=false (set in `src/config.json`).
- Prefer CLI and PowerShell workflows over GUI tools; verify behavior via logs and install scripts.
- Do not edit attached plan files when implementing from a plan.

## Learned Workspace Facts

- R1Wrapper hijacks the Rabbit R1 Hermes ACP slot and routes sessions to Cursor CLI via a Node stdio proxy (`agent acp`), not `agent -p`.
- Install or refresh the hijack with `scripts/install-hijack.ps1`; repair drift with `scripts/repair-hijack.ps1` or the `\R1Wrapper\repair-hijack` scheduled task (does not restart rabbit-agent).
- Check health with `scripts/status.ps1`; proxy logs live at `%LOCALAPPDATA%\R1Wrapper\logs\acp-proxy.log`.
- Default backend is `cursor` in `src/config.json`; set `"backend": "gemini"` to use `gemini --acp` (API key via Gemini CLI store, not config).
- Default R1 agent workspace cwd is `C:\Users\koryi\R1Agent` (rewrites Rabbit's leaked `/home/yt` and leftover `C:\home\yt` junction).
- This dev PC is user koryi; the handoff doc's `C:\Users\Home` paths refer to a different machine.
- rabbit-agent v0.1.10 on this PC spawns `hermes acp` and speaks ACP JSON-RPC NDJSON over stdio.
- Model is applied via `session/set_model` after `session/new`; the CLI `--model` flag does not reliably apply to `agent acp`.
- The proxy forwards `session/prompt` content, including images, through to Cursor.
- Re-run `scripts/install-hijack.ps1` after a Hermes update, which can restore original launcher files.
- `\RabbitR1HermesWatchdog` was a leftover Hermes scheduled task running `rabbit_watchdog.py` every 5 minutes; it could restart rabbit-agent, kill `hermes.exe acp` older than 15 min, and recreate `C:\home\yt` → user home. The task was removed so it cannot interfere with R1Wrapper; the `.py` on disk does nothing without the task.
- Hermes `cron/jobs.json` is empty; Hermes crons are not the R1 hijack path.
