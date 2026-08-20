@echo off
REM ============================================================
REM  DeepSeek Harness - One-Click Deployment
REM
REM  Download this ONE file and double-click it. It will:
REM    1. Verify Node.js and Git
REM    2. Install pnpm if missing
REM    3. Clone the repository
REM    4. Install dependencies and build
REM    5. Apply team config (models, plugins, timezone)
REM    6. Create the Desktop shortcut
REM    7. Pull Supabase env vars via Vercel CLI
REM    8. Launch the app and open your browser
REM
REM  The VS Code extension is not installed by this script -- it iframes the
REM  Web UI instead of driving the SDK directly, so its diff-review and
REM  path-jump features do not work (see docs/improvement-plan.md Phase 3).
REM  Use the Web UI at the URL this script prints.
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
    set "INSTALL_DIR=%~dp0."
    for %%I in ("!INSTALL_DIR!") do set "INSTALL_DIR=%%~fI"
    echo Using existing checkout: !INSTALL_DIR!
)

echo Repository:  %REPO_URL%
echo Install to:  %INSTALL_DIR%
echo.

REM ---------------- Step 1: prerequisites ----------------
echo [1/7] Checking prerequisites...

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
echo [2/7] Getting the code...
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
echo [3/7] Installing dependencies (a few minutes)...
call pnpm install
if errorlevel 1 (
    echo [ERROR] pnpm install failed.
    pause
    exit /b 1
)
echo   [OK] Dependencies installed

REM ---------------- Step 4: build ----------------
echo.
echo [4/7] Building (10-15 minutes - this is normal)...
call pnpm run build
if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)
echo   [OK] Build complete

REM ---------------- Step 5: apply team config ----------------
echo.
echo [5/7] Applying team configuration...

set "DSH_DIR=%USERPROFILE%\.dsh"
set "DSH_PROFILE_DIR=%DSH_DIR%\profiles\web"
set "CONFIG_SRC=%INSTALL_DIR%\dsh-config"

REM Create .dsh dirs if they don't exist yet
if not exist "%DSH_DIR%" mkdir "%DSH_DIR%"
if not exist "%DSH_PROFILE_DIR%" mkdir "%DSH_PROFILE_DIR%"

REM Copy settings.yaml only if the user has no existing config (don't overwrite their keys)
if not exist "%DSH_DIR%\settings.yaml" (
    copy /Y "%CONFIG_SRC%\settings.yaml" "%DSH_DIR%\settings.yaml" >nul
    echo   [OK] settings.yaml applied (OpenRouter models + web search config)
) else (
    echo   [--] settings.yaml already exists - skipping to preserve your API keys
    echo        To reset to team defaults: copy "%CONFIG_SRC%\settings.yaml" "%DSH_DIR%\settings.yaml"
)

REM Always update cordis.patch.yml (system-prompt timezone, no secrets)
copy /Y "%CONFIG_SRC%\cordis.patch.yml" "%DSH_PROFILE_DIR%\cordis.patch.yml" >nul
echo   [OK] cordis.patch.yml applied (system-prompt timezone for the harness:date section)

REM ---------------- Step 6: shortcut ----------------
echo.
echo [6/7] Creating Desktop shortcut...
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -ExecutionPolicy Bypass -NoProfile -File "%INSTALL_DIR%\create-shortcut.ps1"
if errorlevel 1 (
    echo [ERROR] Shortcut creation failed.
    pause
    exit /b 1
)

REM ---------------- Step 7: pull team env vars via Vercel CLI ----------------
echo.
echo [7/7] Pulling team environment variables (API keys, Supabase, MCP)...
echo        This requires a Corvus Construction Vercel account.
echo.

REM Shared with start-dsh.ps1's every-launch refresh, so both entry points
REM pull the same way instead of drifting apart. -AllowLogin is passed here
REM because an interactive browser sign-in is already the expected flow
REM during first-time setup; start-dsh.ps1 omits it so a later double-click
REM of the Desktop shortcut never blocks on a sign-in nobody asked for.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -ExecutionPolicy Bypass -NoProfile -File "%INSTALL_DIR%\pull-team-env.ps1" -AllowLogin

echo.
echo ============================================================
echo   SUCCESS - Setup Complete
echo ============================================================
echo.
echo Installed to: %INSTALL_DIR%
echo.
echo Next steps (after launch):
echo   1. Go to Settings ^> Models ^> openrouter and add your API key
echo        OpenRouter: https://openrouter.ai/settings/keys
echo   2. Go to Settings ^> Plugins ^> Web search and add your DeepSeek key
echo        DeepSeek:   https://platform.deepseek.com
echo   3. Click Apply, pick a model, start chatting
echo.
echo Models pre-configured: Auto Router, DeepSeek V4, Qwen3, Gemini Flash Image
echo Web search: enabled (via Vercel env pull)
echo Date awareness: enabled (agent's system prompt states today's date)
echo Supabase MCP: enabled for all Corax projects (via Vercel env pull)
echo.
pause

REM ---------------- Launch ----------------
echo.
echo Launching DeepSeek Harness...
set "SHORTCUT=%USERPROFILE%\Desktop\DeepSeek Harness.lnk"
if exist "%SHORTCUT%" (
    REM Opens a new window running start-dsh.ps1 -- the same thing double-clicking
    REM the Desktop shortcut does. This deploy script's own window can close
    REM once that one is up; close the NEW window to stop the server.
    start "" "%SHORTCUT%"
    echo   [OK] Launched -- a new window will open your browser to http://127.0.0.1:3080
) else (
    echo   [!!] Shortcut not found at %SHORTCUT% -- launch manually:
    echo        powershell -ExecutionPolicy Bypass -File "%INSTALL_DIR%\start-dsh.ps1"
)
echo.
pause
