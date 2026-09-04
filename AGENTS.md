## Learned User Preferences

- Default R1/Cursor backend model is Composer 2.5 with fast=false (set in `src/config.json`). Use Composer 2.5 for plan-execution subagents as well.
- Prefer CLI and PowerShell workflows over GUI tools; verify behavior via logs and install scripts.
- Do not edit attached plan files when implementing from a plan.

## Learned Workspace Facts

- R1Wrapper hijacks the Rabbit R1 Hermes ACP slot and routes sessions to Cursor CLI via a Node stdio proxy (`agent acp`), not `agent -p`.
- Clone somewhere stable, then install with `scripts/install-hijack.ps1`; wrappers and the repair task bake in that clone path. Repair drift with `scripts/repair-hijack.ps1` or `\R1Wrapper\repair-hijack` (does not restart rabbit-agent).
- Check health with `scripts/status.ps1`; proxy logs live at `%LOCALAPPDATA%\R1Wrapper\logs\acp-proxy.log`. README is at repo root (Windows/PowerShell; no keys in config).
- Default backend is `cursor` in `src/config.json`; set `"backend": "gemini"` to use `gemini --acp` (API key via Gemini CLI store, not config).
- Shipped `cwd` is `%USERPROFILE%\R1Agent` (expands per Windows user; do not hardcode `C:\Users\koryi\R1Agent` in committed config). Proxy still rewrites Rabbit's leaked `/home/yt` and leftover `C:\home\yt` junction.
- This dev PC is user koryi; the handoff doc's `C:\Users\Home` paths refer to a different machine.
- rabbit-agent v0.1.10 on this PC spawns `hermes acp` and speaks ACP JSON-RPC NDJSON over stdio.
- Model is applied via `session/set_model` after `session/new`; the CLI `--model` flag does not reliably apply to `agent acp`.
- The proxy forwards `session/prompt` content, including images, through to Cursor.
- Re-run `scripts/install-hijack.ps1` only if Hermes restored launchers, the repo moved, or this is a new Windows machine. A cwd/config-only change does not need reinstall; the proxy reads config on session start. Install restarts rabbit-agent.
- `\RabbitR1HermesWatchdog` was a leftover Hermes scheduled task (`rabbit_watchdog.py` every 5 min) that could restart rabbit-agent and recreate `C:\home\yt`. Install removes it if present; the `.py` on disk does nothing without the task.
- Hermes `cron/jobs.json` is empty; Hermes crons are not the R1 hijack path.
