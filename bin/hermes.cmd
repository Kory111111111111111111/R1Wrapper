@echo off
setlocal EnableExtensions

set "REAL_HERMES=%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe"
set "PROXY=%~dp0..\src\acp-proxy.mjs"

if /I "%~1"=="acp" (
  shift
  node "%PROXY%" %*
  exit /b %ERRORLEVEL%
)

if not exist "%REAL_HERMES%" (
  echo [r1wrapper] Real Hermes binary not found: %REAL_HERMES% >&2
  exit /b 1
)

"%REAL_HERMES%" %*
exit /b %ERRORLEVEL%
