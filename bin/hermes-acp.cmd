@echo off
setlocal EnableExtensions

set "PROXY=%~dp0..\src\acp-proxy.mjs"
node "%PROXY%" %*
exit /b %ERRORLEVEL%
