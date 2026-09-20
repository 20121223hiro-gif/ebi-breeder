@echo off
rem Start the local server (if not running) and open the game in the browser.
cd /d "%~dp0"
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 15310 -State Listen -ErrorAction SilentlyContinue)) { Start-Process -WindowStyle Hidden node -ArgumentList 'serve.cjs'; Start-Sleep -Seconds 1 }"
start "" "http://localhost:15310/"
