# Creates the "DeepSeek Harness" Desktop shortcut pointing at this checkout.
# Called by setup-launcher.bat and by the one-click deployer.

$ErrorActionPreference = "Stop"

$repoPath = $PSScriptRoot
if (-not $repoPath) { $repoPath = Split-Path -Parent $MyInvocation.MyCommand.Definition }

$launcher = Join-Path $repoPath "start-dsh.ps1"
$icon     = Join-Path $repoPath "deepseek-official.ico"

if (-not (Test-Path $launcher)) {
    Write-Host "[ERROR] start-dsh.ps1 not found in $repoPath" -ForegroundColor Red
    exit 1
}

$desktop      = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "DeepSeek Harness.lnk"

$shell = New-Object -ComObject WScript.Shell
$link  = $shell.CreateShortcut($shortcutPath)

# powershell.exe (5.1) is always present; pwsh may not be.
$link.TargetPath       = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments        = "-NoExit -ExecutionPolicy Bypass -NoProfile -File `"$launcher`""
$link.WorkingDirectory = $repoPath
$link.Description      = "Start DeepSeek Harness Web UI"
if (Test-Path $icon) { $link.IconLocation = $icon }
$link.Save()

Write-Host "[OK] Shortcut created: $shortcutPath" -ForegroundColor Green
Write-Host "     Launches: $launcher" -ForegroundColor Gray
