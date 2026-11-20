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

echo [1/5] Checking local environment files ...
if not exist "server\.env" (
  copy /Y "server\.env.example" "server\.env" >nul
  echo       Created server\.env from template - please change the password/secret before going online.
) else (
  echo       server\.env OK
)
if not exist "client\.env" (
  copy /Y "client\.env.example" "client\.env" >nul
  echo       Created client\.env from template.
) else (
  echo       client\.env OK
)

echo [2/5] Checking backend dependencies ...
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

echo [3/5] Checking frontend dependencies ...
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

echo [4/5] Starting BACKEND  (API + SQLite, port 3000) ...
start "ChanTion BACKEND - do not close" cmd /k "cd /d ""%ROOT%\server"" && npm start"

echo [5/5] Starting FRONTEND (page, port 5173) ...
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
