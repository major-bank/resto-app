@echo off
rem ============================================
rem  YunWei Resto - auto start node server + tunnel
rem  Idempotent: skip if already running
rem ============================================
set DIR=C:\Users\86183\WorkBuddy\2026-08-25-10-39-57\resto-app
cd /d "%DIR%"

rem --- 1. start node server if not running ---
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if errorlevel 1 (
  start "resto-node" /min cmd /c "node server.js >> server.log 2>&1"
  ping -n 3 127.0.0.1 >nul
)

rem --- 2. start cloudflared tunnel if not running ---
tasklist /FI "IMAGENAME eq cloudflared.exe" 2>nul | find /I "cloudflared.exe" >nul
if errorlevel 1 (
  start "resto-tunnel" /min cmd /c "cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate >> tunnel.err.log 2>&1"
)

rem --- 3. wait for public url, write pure url to desktop ---
set /a tries=0
:loop
set /a tries+=1
findstr /R "https://[a-z0-9-]*.trycloudflare.com" tunnel.err.log >nul 2>&1
if not errorlevel 1 goto :found
if %tries% lss 20 (
  ping -n 3 127.0.0.1 >nul
  goto :loop
)
:found
powershell -NoProfile -Command "$m=(Select-String -Path 'tunnel.err.log' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1).Matches[0].Value; if($m){$m | Set-Content -Path $env:USERPROFILE\Desktop\resto-url.txt -Encoding ascii}"
if exist "%USERPROFILE%\Desktop\resto-url.txt" type "%USERPROFILE%\Desktop\resto-url.txt"
