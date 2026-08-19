@echo off
REM ============================================================
REM  DeepSeek Harness - One-Click Deployment
REM
REM  Download this ONE file and double-click it. It will:
REM    1. Verify Node.js and Git
REM    2. Install pnpm if missing
REM    3. Clone the repository
REM    4. Install dependencies and build
REM    5. Apply team config (models, plugins, time-context)
REM    6. Create the Desktop shortcut
REM    7. Install VS Code extension (if VS Code is present)
REM    8. Pull Supabase env vars via Vercel CLI (artifact publishing)
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
echo [1/8] Checking prerequisites...

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
echo [2/8] Getting the code...
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
echo [3/8] Installing dependencies (a few minutes)...
call pnpm install
if errorlevel 1 (
    echo [ERROR] pnpm install failed.
    pause
    exit /b 1
)
echo   [OK] Dependencies installed

REM ---------------- Step 4: build ----------------
echo.
echo [4/8] Building (10-15 minutes - this is normal)...
call pnpm run build
if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)
echo   [OK] Build complete

REM ---------------- Step 5: apply team config ----------------
echo.
echo [5/8] Applying team configuration...

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

REM Always update cordis.patch.yml (time-context plugin, no secrets)
copy /Y "%CONFIG_SRC%\cordis.patch.yml" "%DSH_PROFILE_DIR%\cordis.patch.yml" >nul
echo   [OK] cordis.patch.yml applied (time-context plugin - agent knows current date/time)

REM ---------------- Step 6: shortcut ----------------
echo.
echo [6/8] Creating Desktop shortcut...
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -ExecutionPolicy Bypass -NoProfile -File "%INSTALL_DIR%\create-shortcut.ps1"
if errorlevel 1 (
    echo [ERROR] Shortcut creation failed.
    pause
    exit /b 1
)

REM ---------------- Step 7: VS Code extension ----------------
echo.
echo [7/8] Installing VS Code extension...

REM Locate the VS Code CLI - check PATH first, then common install locations
set "CODE_CMD="
where code >nul 2>&1
if not errorlevel 1 (
    set "CODE_CMD=code"
) else if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd" (
    set "CODE_CMD=%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd"
) else if exist "%ProgramFiles%\Microsoft VS Code\bin\code.cmd" (
    set "CODE_CMD=%ProgramFiles%\Microsoft VS Code\bin\code.cmd"
)

if not defined CODE_CMD (
    echo   [--] VS Code not found - skipping extension install
    echo        To install later: open VS Code, press Ctrl+Shift+P,
    echo        choose "Install from VSIX", pick apps\vscode\dsh.vsix
    goto :vscode_done
)

echo   [..] Compiling extension...
call pnpm --filter dsh-vscode run build
if errorlevel 1 (
    echo [ERROR] VS Code extension compile failed.
    echo        The web UI is still fully functional without it.
    goto :vscode_done
)

echo   [..] Packaging extension...
call pnpm --filter dsh-vscode run package:vsix
if errorlevel 1 (
    echo [ERROR] VS Code extension packaging failed.
    echo        The web UI is still fully functional without it.
    goto :vscode_done
)

echo   [..] Installing extension into VS Code...
call "%CODE_CMD%" --install-extension "%INSTALL_DIR%\apps\vscode\dsh.vsix" --force
if errorlevel 1 (
    echo [ERROR] VS Code extension install failed.
    echo        You can install it manually: apps\vscode\dsh.vsix
    goto :vscode_done
)
echo   [OK] VS Code extension installed (command: DSH: Open Chat)

:vscode_done
cd /d "%INSTALL_DIR%"

REM ---------------- Step 8: pull team env vars via Vercel CLI ----------------
echo.
echo [8/8] Pulling team environment variables (API keys, Supabase, MCP)...
echo        This requires a Corvus Construction Vercel account.
echo.

REM Install Vercel CLI globally if it isn't already present.
where vercel >nul 2>&1
if errorlevel 1 (
    echo   [..] Vercel CLI not found. Installing...
    call npm install -g vercel
    if errorlevel 1 (
        echo   [!!] Could not install Vercel CLI - skipping key setup.
        echo        Ask a team member to copy %USERPROFILE%\.dsh\.env from their machine.
        goto :vercel_done
    )
    echo   [OK] Vercel CLI installed
)

REM Check if already authenticated - vercel whoami exits 0 if logged in.
vercel whoami >nul 2>&1
if errorlevel 1 (
    echo   [..] You are not logged into Vercel.
    echo        A browser window will open - sign in with your Corvus Construction account.
    echo.
    call vercel login
    if errorlevel 1 (
        echo   [!!] Vercel login failed or was cancelled - skipping key setup.
        echo        Re-run this step manually: vercel env pull "%USERPROFILE%\.dsh\.env" --project corax --yes
        goto :vercel_done
    )
    echo   [OK] Logged into Vercel
)

REM Pull all team env vars from the corax Vercel project into .dsh\.env
call vercel env pull "%USERPROFILE%\.dsh\.env" --project corax --yes
if errorlevel 1 (
    echo   [!!] vercel env pull failed.
    echo        Make sure your Vercel account has access to the "corax" project.
    echo        Re-run manually: vercel env pull "%USERPROFILE%\.dsh\.env" --project corax --yes
    goto :vercel_done
)
echo   [OK] Team env vars written to %USERPROFILE%\.dsh\.env
echo        Includes: OpenRouter, Supabase (all projects), Supabase MCP token

:vercel_done

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
echo   3. Go to Settings ^> Models ^> openrouter and add your API key
echo        OpenRouter: https://openrouter.ai/settings/keys
echo   4. Go to Settings ^> Plugins ^> Web search and add your DeepSeek key
echo        DeepSeek:   https://platform.deepseek.com
echo   5. Click Apply, pick a model, start chatting
echo.
echo Models pre-configured: Auto Router, DeepSeek V4, Qwen3, Gemini Flash Image
echo Web search: enabled (via Vercel env pull)
echo Time awareness: enabled (agent always knows the current date/time)
echo Supabase MCP: enabled for all Corax projects (via Vercel env pull)
echo Artifact publishing: enabled (uploads to Corax AI Supabase project)
echo VS Code: DSH: Open Chat command available (if VS Code was detected)
echo.
echo Close the PowerShell window to stop the server.
echo.
pause
