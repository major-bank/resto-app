@echo off
rem ============================================
rem  YunWei Resto - auto start node server + tunnel (v3)
rem  通过 daemon-start.js 幂等孵化独立进程(含隧道健康自愈)
rem ============================================
set DIR=C:\Users\86183\WorkBuddy\2026-08-25-10-39-57\resto-app
set NODE_EXE=C:\Users\86183\.workbuddy\binaries\node\versions\22.22.2\node.exe
cd /d "%DIR%"

"%NODE_EXE%" daemon-start.js

rem --- wait for public url, write LAST url to desktop ---
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
powershell -NoProfile -Command "$m=(Select-String -Path 'tunnel.err.log' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -Last 1).Matches[0].Value; if($m){$m | Set-Content -Path $env:USERPROFILE\Desktop\resto-url.txt -Encoding ascii}"
if exist "%USERPROFILE%\Desktop\resto-url.txt" type "%USERPROFILE%\Desktop\resto-url.txt"
