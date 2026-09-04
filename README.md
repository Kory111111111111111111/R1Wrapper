# R1Wrapper

Windows-only. This hijacks the Rabbit R1 **Hermes ACP** slot on your PC and sends those sessions to **Cursor CLI** (`agent acp`) instead of real Hermes. Gemini CLI is a config switch if you want it.

Nothing is installed on the R1. Wiping or factory-resetting the R1 does **not** undo this. The hijack lives on the PC.

Rabbit still talks to `rabbit-agent` on the machine. We just swap what `hermes acp` actually launches.

```
R1 (Hermes page) → Rabbit cloud → rabbit-agent → fake hermes.cmd → R1Wrapper proxy → Cursor or Gemini
```

## You need

- Windows
- Node 20+
- [rabbit-agent](https://hole.rabbit.tech) registered to **your** Rabbit account (Settings → Nodes)
- Hermes CLI installed (`%LOCALAPPDATA%\hermes`) so there is a launcher to hijack
- Cursor CLI (`agent`) signed in, **or** Gemini CLI if you switch the backend

Stay on stock RabbitOS. This is the PC-side pipe, not a firmware flash.

## Install

Clone this repo somewhere you will not move. The wrappers and the repair task bake in that path.

PowerShell:

```powershell
cd <where-you-cloned-R1Wrapper>
.\scripts\install-hijack.ps1
.\scripts\status.ps1
```

That will:

- Point `%LOCALAPPDATA%\hermes\bin\hermes.cmd` (and `hermes-acp.cmd`) at this repo
- Create `%USERPROFILE%\R1Agent` (that is the workspace the R1 agent writes into)
- Register a hidden `\R1Wrapper\repair-hijack` task (fixes drifted launchers; does **not** restart rabbit-agent)
- Remove leftover `\RabbitR1HermesWatchdog` if it is still registered
- Restart rabbit-agent once (install only)

Then on the R1: **Hermes Agent** page, not Claude Code / OpenClaw. PTT something short. If it says no computers found, refresh that page and confirm you are on the same Rabbit account as the node.

After a Hermes update, run `.\scripts\install-hijack.ps1` again. Hermes likes to put its own `hermes.cmd` back.

## Config

`src/config.json` is the whole thing. Do not put API keys in it. Gemini auth stays in the Gemini CLI store. Cursor auth stays in Cursor CLI.

**Workspace** (`cwd`): where files from the R1 land.

```json
"cwd": "%USERPROFILE%\\R1Agent"
```

That follows whoever is logged into Windows. You can also set a full path if you want the workspace somewhere else. Only edit `cwd` if you want a different folder — the shipped default is already portable.

**Backend:** only switch this:

```json
"backend": "cursor"
```

or

```json
"backend": "gemini"
```

After a provider switch, start a **new** Hermes session on the R1. Do not change other fields unless you know why.

Default Cursor model is Composer 2.5 (`fast: false`). The `--model` flag on `agent acp` is flaky; the proxy sets the model after `session/new`.

## Logs / health

```powershell
.\scripts\status.ps1
```

Proxy log:

```text
%LOCALAPPDATA%\R1Wrapper\logs\acp-proxy.log
```

That is **not** the workspace. The workspace is `%USERPROFILE%\R1Agent`. If you want the R1 agent to follow extra instructions, put an `AGENTS.md` in **that** folder, not next to this repo's logs.

## Leftover Hermes watchdog

Some older Hermes R1 setups registered `\RabbitR1HermesWatchdog` (runs `rabbit_watchdog.py` every 5 minutes). That can restart rabbit-agent mid-session. `install-hijack.ps1` removes that task. If it is still there, delete it:

```powershell
Unregister-ScheduledTask -TaskName "RabbitR1HermesWatchdog" -Confirm:$false
```

The `.py` file sitting under `%LOCALAPPDATA%\hermes\scripts` does nothing if the task is gone. Do not confuse the flash of a PowerShell window with that script; our repair task is supposed to stay hidden.

## Uninstall

```powershell
.\scripts\install-hijack.ps1 -Uninstall
```

Restores the backed-up Hermes launchers if they are still there, removes this repo from user PATH, drops the repair task, restarts rabbit-agent.

## Tests

```powershell
npm test
```
