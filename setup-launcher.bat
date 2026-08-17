@echo off
REM DeepSeek Harness Setup Script
REM Creates Desktop launcher shortcut and displays setup instructions

setlocal enabledelayedexpansion

echo.
echo ================================================
echo   DeepSeek Harness Setup
echo ================================================
echo.

REM Get repo path
set "REPO_PATH=%~dp0"
echo Repository: %REPO_PATH%

REM Check if pnpm is installed
echo.
echo Checking pnpm...
pnpm --version >nul 2>&1
if errorlevel 1 (
    echo [WARNING] pnpm not found. Installing...
    npm install -g pnpm@11.7.0
) else (
    for /f "tokens=*" %%i in ('pnpm --version') do set PNPM_VER=%%i
    echo [OK] pnpm version: !PNPM_VER!
)

REM Create shortcut using VBS
echo.
echo Creating Desktop shortcut...

set "VBS_FILE=%TEMP%\create_shortcut.vbs"
(
    echo Set objShell = CreateObject("WScript.Shell"^)
    echo Set objFSO = CreateObject("Scripting.FileSystemObject"^)
    echo.
    echo strDesktop = objShell.SpecialFolders("Desktop"^)
    echo shortcutPath = strDesktop ^& "\DeepSeek Harness.lnk"
    echo.
    echo Set objLink = objShell.CreateShortcut(shortcutPath^)
    echo objLink.TargetPath = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
    echo objLink.Arguments = "-NoExit -ExecutionPolicy Bypass -NoProfile -File """ ^& "%REPO_PATH%start-dsh.ps1" ^& """"
    echo objLink.WorkingDirectory = "%REPO_PATH%"
    echo objLink.IconLocation = "%REPO_PATH%deepseek-official.ico"
    echo objLink.Description = "Start DeepSeek Harness Web UI"
    echo objLink.Save
    echo.
    echo WScript.Echo "Shortcut created: " ^& shortcutPath
) > "%VBS_FILE%"

cscript.exe "%VBS_FILE%"
del "%VBS_FILE%"

echo.
echo ================================================
echo   Setup Complete!
echo ================================================
echo.
echo Next steps:
echo.
echo 1. Run dependencies (one-time only):
echo    pnpm install
echo    pnpm run build
echo.
echo 2. Look for "DeepSeek Harness" shortcut on Desktop
echo.
echo 3. Double-click the shortcut to start
echo.
echo 4. Read ONBOARDING.md for configuration help
echo.
echo ================================================
echo.
pause
