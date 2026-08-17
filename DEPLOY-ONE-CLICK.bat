@echo off
REM ============================================================
REM  DeepSeek Harness - One-Click Deployment
REM
REM  Download this ONE file and double-click it. It will:
REM    1. Verify Node.js and Git
REM    2. Install pnpm if missing
REM    3. Clone the repository
REM    4. Install dependencies and build
REM    5. Create the Desktop shortcut
REM
REM  Prerequisite: Node.js 22.19+ (https://nodejs.org)
REM  Time: ~25-30 minutes on first run
REM ============================================================

setlocal enabledelayedexpansion
cls

set "REPO_URL=https://github.com/lkelly-construct/deepseek-harness.git"
set "INSTALL_DIR=%USERPROFILE%\DeepSeek-Harness"

echo.
echo ============================================================
echo   DeepSeek Harness - Automated Setup
echo ============================================================
echo.

REM --- If this file already sits inside a checkout, use that checkout. ---
if exist "%~dp0start-dsh.ps1" if exist "%~dp0package.json" (
    set "INSTALL_DIR=%~dp0"
    echo Using existing checkout: !INSTALL_DIR!
)

echo Repository:  %REPO_URL%
echo Install to:  %INSTALL_DIR%
echo.

REM ---------------- Step 1: prerequisites ----------------
echo [1/5] Checking prerequisites...

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    echo         Install Node.js 22.19+ from https://nodejs.org then re-run this file.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo   [OK] Node.js !NODE_VER!

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git not found.
    echo         Install Git from https://git-scm.com then re-run this file.
    pause
    exit /b 1
)
echo   [OK] Git found

where pnpm >nul 2>&1
if errorlevel 1 (
    echo   [..] pnpm not found. Installing pnpm 11.7.0...
    call npm install -g pnpm@11.7.0
    if errorlevel 1 (
        echo [ERROR] Could not install pnpm.
        pause
        exit /b 1
    )
    echo   [OK] pnpm installed
) else (
    for /f "tokens=*" %%i in ('pnpm --version') do set PNPM_VER=%%i
    echo   [OK] pnpm !PNPM_VER!
)

REM ---------------- Step 2: get the code ----------------
echo.
echo [2/5] Getting the code...
if exist "%INSTALL_DIR%\.git" (
    echo   [OK] Repository already present
) else (
    echo   [..] Cloning...
    call git clone "%REPO_URL%" "%INSTALL_DIR%"
    if errorlevel 1 (
        echo [ERROR] Clone failed. Check your network and repository access.
        pause
        exit /b 1
    )
    echo   [OK] Cloned
)
cd /d "%INSTALL_DIR%"

REM ---------------- Step 3: dependencies ----------------
echo.
echo [3/5] Installing dependencies (a few minutes)...
call pnpm install
if errorlevel 1 (
    echo [ERROR] pnpm install failed.
    pause
    exit /b 1
)
echo   [OK] Dependencies installed

REM ---------------- Step 4: build ----------------
echo.
echo [4/5] Building (10-15 minutes - this is normal)...
call pnpm run build
if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)
echo   [OK] Build complete

REM ---------------- Step 5: shortcut ----------------
echo.
echo [5/5] Creating Desktop shortcut...
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%INSTALL_DIR%\create-shortcut.ps1"
if errorlevel 1 (
    echo [ERROR] Shortcut creation failed.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   SUCCESS - Setup Complete
echo ============================================================
echo.
echo Installed to: %INSTALL_DIR%
echo.
echo Next steps:
echo   1. Double-click "DeepSeek Harness" on your Desktop
echo   2. Your browser opens to http://127.0.0.1:3080
echo   3. Go to Settings ^> Models and add your API key
echo        OpenRouter: https://openrouter.ai/settings/keys
echo        DeepSeek:   https://platform.deepseek.com
echo   4. Click Apply, pick a model, start chatting
echo.
echo Close the PowerShell window to stop the server.
echo.
pause
