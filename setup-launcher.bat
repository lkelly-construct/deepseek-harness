@echo off
REM Creates the "DeepSeek Harness" Desktop shortcut for this checkout.
REM Run this if the shortcut is missing or the folder has been moved.

echo.
echo ================================================
echo   DeepSeek Harness - Create Desktop Shortcut
echo ================================================
echo.

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0create-shortcut.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Could not create the shortcut.
    pause
    exit /b 1
)

echo.
echo Done. Double-click "DeepSeek Harness" on your Desktop to start.
echo.
pause
