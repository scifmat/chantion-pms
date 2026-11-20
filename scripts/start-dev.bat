@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo ============================================================
echo   ChanTion-PMS  -  Step 1 skeleton  (development mode)
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Please install Node.js LTS from https://nodejs.org  then run this file again.
  echo.
  pause
  exit /b 1
)

echo [1/4] Checking backend dependencies ...
if not exist "server\node_modules\express" (
  pushd server
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] Backend dependency install failed. See the messages above.
    popd
    pause
    exit /b 1
  )
  popd
) else (
  echo       OK (already installed)
)

echo [2/4] Checking frontend dependencies ...
if not exist "client\node_modules\vue" (
  pushd client
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] Frontend dependency install failed. See the messages above.
    popd
    pause
    exit /b 1
  )
  popd
) else (
  echo       OK (already installed)
)

echo [3/4] Starting BACKEND  (API + SQLite, port 3000) ...
start "ChanTion BACKEND - do not close" cmd /k "cd /d ""%ROOT%\server"" && npm start"

echo [4/4] Starting FRONTEND (page, port 5173) ...
start "ChanTion FRONTEND - do not close" cmd /k "cd /d ""%ROOT%\client"" && npm run dev"

echo.
echo ============================================================
echo   READY.  Open this address in your browser:
echo.
echo       http://localhost:5173
echo.
echo   Two black windows are the running services.
echo   Keep them open while using the system.
echo   To STOP: close those two black windows.
echo ============================================================
echo.
pause
