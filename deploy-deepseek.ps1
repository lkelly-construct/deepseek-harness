#!/usr/bin/env pwsh
<#
.SYNOPSIS
    DeepSeek Harness - One-Click Deployment Script
.DESCRIPTION
    Automates the complete setup process:
    1. Clones the repository (if needed)
    2. Installs dependencies (pnpm install)
    3. Builds the project (pnpm run build)
    4. Creates Desktop launcher
    5. Launches the app

.NOTES
    Prerequisites: Node.js 22+ installed
    Time: ~20-30 minutes on first run
#>

param(
    [string]$RepoUrl = "https://github.com/deepseek-ai/deepseek-harness.git",
    [string]$InstallDir = "C:\DeepSeek-Harness"
)

$ErrorActionPreference = "Stop"

# Colors
function Write-Info { Write-Host "[INFO] " -ForegroundColor Cyan -NoNewline; Write-Host $args }
function Write-Success { Write-Host "[OK] " -ForegroundColor Green -NoNewline; Write-Host $args }
function Write-Error { Write-Host "[ERROR] " -ForegroundColor Red -NoNewline; Write-Host $args }
function Write-Step { Write-Host "`n[Step $args]" -ForegroundColor Yellow }

try {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  DeepSeek Harness - Automated Setup" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""

    Write-Info "Repository: $RepoUrl"
    Write-Info "Install Location: $InstallDir"
    Write-Host ""

    # Step 1: Clone or navigate to repo
    Write-Step "1/5 - Repository"
    if (Test-Path "$InstallDir\.git") {
        Write-Success "Repository already exists"
        Push-Location $InstallDir
    }
    else {
        Write-Info "Cloning repository (this may take a minute)..."
        if (Test-Path $InstallDir) {
            Remove-Item $InstallDir -Recurse -Force
        }

        git clone $RepoUrl $InstallDir
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to clone repository"
            Write-Info "Check the repository URL: $RepoUrl"
            exit 1
        }

        Push-Location $InstallDir
        Write-Success "Repository cloned"
    }

    # Step 2: Install dependencies
    Write-Step "2/5 - Dependencies"
    Write-Info "Installing pnpm packages (this takes a few minutes)..."
    & pnpm install
    if ($LASTEXITCODE -ne 0) {
        Write-Error "pnpm install failed"
        exit 1
    }
    Write-Success "Dependencies installed"

    # Step 3: Build project
    Write-Step "3/5 - Build"
    Write-Info "Building project (this takes 10-15 minutes)..."
    Write-Info "This is normal - TypeScript compilation, API generation, Web UI bundling..."
    & pnpm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "pnpm build failed"
        exit 1
    }
    Write-Success "Build complete"

    # Step 4: Create launcher
    Write-Step "4/5 - Desktop Launcher"
    Write-Info "Creating Desktop shortcut..."

    $DesktopPath = [Environment]::GetFolderPath("Desktop")
    $ShortcutPath = "$DesktopPath\DeepSeek Harness.lnk"

    # Create VBS script to make shortcut
    $VBSScript = @"
Set objShell = CreateObject("WScript.Shell")
Set objLink = objShell.CreateShortcut("$ShortcutPath")
objLink.TargetPath = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
objLink.Arguments = "-NoExit -ExecutionPolicy Bypass -NoProfile -File `"$InstallDir\start-dsh.ps1`""
objLink.WorkingDirectory = "$InstallDir"
objLink.IconLocation = "$InstallDir\deepseek-official.ico"
objLink.Description = "Start DeepSeek Harness Web UI"
objLink.Save
"@

    $VBSPath = "$env:TEMP\create_dsh_shortcut.vbs"
    $VBSScript | Out-File -FilePath $VBSPath -Encoding ASCII
    cscript.exe $VBSPath | Out-Null
    Remove-Item $VBSPath -Force

    Write-Success "Desktop launcher created"

    # Step 5: Launch
    Write-Step "5/5 - Launch"
    Write-Info "Starting DeepSeek Harness..."
    Write-Info "Browser will open in a moment..."

    & "$InstallDir\start-dsh.ps1"

}
catch {
    Write-Error $_.Exception.Message
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Make sure Node.js 22+ is installed: node --version"
    Write-Host "2. Make sure Git is installed: git --version"
    Write-Host "3. Check internet connection for cloning"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}
finally {
    Pop-Location -ErrorAction SilentlyContinue
}
