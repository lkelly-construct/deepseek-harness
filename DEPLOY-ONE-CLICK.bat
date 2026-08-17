@echo off
REM ============================================================
REM  DeepSeek Harness - One-Click Deployment
REM
REM  This script does EVERYTHING:
REM  - Clones the repo (or uses existing)
REM  - Installs dependencies (pnpm install)
REM  - Builds the project (pnpm run build)
REM  - Creates Desktop launcher
REM  - Launches the app
REM
REM  Just run this file and wait. Takes ~20-30 minutes first time.
REM ============================================================

setlocal enabledelayedexpansion

REM Colors (for Windows 10+)
cls
echo.
echo ============================================================
echo   DeepSeek Harness - Automated Setup
echo ============================================================
echo.

REM Configuration
set "REPO_URL=https://github.com/your-org/deepseek-harness.git"
set "INSTALL_DIR=C:\DeepSeek-Harness"

echo Repository: %REPO_URL%
echo Install Location: %INSTALL_DIR%
echo.

REM Step 1: Clone or navigate to existing repo
echo [1/5] Checking repository...
if exist "%INSTALL_DIR%\.git" (
    echo [OK] Repository already exists
    cd /d "%INSTALL_DIR%"
) else (
    echo [CLONE] Downloading repository...
    if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"
    git clone "%REPO_URL%" "%INSTALL_DIR%"
    if errorlevel 1 (
        echo [ERROR] Failed to clone repository
        echo Please check the repository URL and try again
        pause
        exit /b 1
    )
    cd /d "%INSTALL_DIR%"
)

REM Step 2: Install dependencies
echo.
echo [2/5] Installing dependencies...
echo This may take a few minutes...
call pnpm install
if errorlevel 1 (
    echo [ERROR] pnpm install failed
    pause
    exit /b 1
)

REM Step 3: Build project
echo.
echo [3/5] Building project...
echo This may take 10-15 minutes on first run...
call pnpm run build
if errorlevel 1 (
    echo [ERROR] pnpm build failed
    pause
    exit /b 1
)

REM Step 4: Create Desktop launcher
echo.
echo [4/5] Creating Desktop launcher...
call setup-launcher.bat

REM Step 5: Success message
echo.
echo ============================================================
echo   SUCCESS! Setup Complete!
echo ============================================================
echo.
echo What's next:
echo.
echo 1. Look for "DeepSeek Harness" shortcut on your Desktop
echo.
echo 2. Double-click it to launch (opens in browser)
echo.
echo 3. Go to Settings ^> Models to add your API keys:
echo    - OpenRouter: https://openrouter.ai
echo    - DeepSeek: https://platform.deepseek.com
echo.
echo 4. Start chatting!
echo.
echo Installation folder: %INSTALL_DIR%
echo.
echo ============================================================
echo.
pause
