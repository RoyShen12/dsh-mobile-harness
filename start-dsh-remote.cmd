@echo off
rem Double-click entry point: starts DeepSeek Harness + the remote-access proxy + tunnel.
rem Quit DSH from the tray first. Pass-through args, e.g.:
rem   start-dsh-remote.cmd -Tunnel tailscale
rem   start-dsh-remote.cmd -Tunnel none
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-dsh-remote.ps1" %*
if errorlevel 1 pause
endlocal
