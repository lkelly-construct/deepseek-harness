$ErrorActionPreference = "Continue"

try {
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host "  DeepSeek Harness Launcher" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host ""

    # Resolve the repo from this script's own location so the launcher works
    # from any install directory, not just the machine it was authored on.
    $repoPath = $PSScriptRoot
    if (-not $repoPath) { $repoPath = Split-Path -Parent $MyInvocation.MyCommand.Definition }
    $url = "http://127.0.0.1:3080"

    Write-Host "Repository: $repoPath" -ForegroundColor Gray

    Push-Location $repoPath

    # pnpm missing is a setup problem, not a crash -- say so plainly.
    Write-Host "Checking pnpm..." -ForegroundColor Yellow
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpm) {
        throw "pnpm is not installed. Run: npm install -g pnpm@11.7.0"
    }
    $pnpmVersion = & pnpm --version 2>&1
    Write-Host "  pnpm version: $pnpmVersion" -ForegroundColor Green

    # Launching before a build produces a 200-line plugin-tree stack trace.
    # Check one client bundle instead and give the actual fix.
    if (-not (Test-Path (Join-Path $repoPath "packages\client\runtime\lib\client.js"))) {
        throw "Project is not built yet. Run this once from $repoPath :  pnpm install ; pnpm run build"
    }

    Write-Host ""
    Write-Host "Launching pnpm dsh web..." -ForegroundColor Cyan
    Write-Host "Waiting for server to be ready..." -ForegroundColor Gray
    Write-Host ""

    # The job runs in its own runspace and inherits nothing, so the path is
    # passed in explicitly.
    $job = Start-Job -ArgumentList $repoPath -ScriptBlock {
        param($RepoRoot)
        Set-Location $RepoRoot
        & pnpm dsh web 2>&1
    }

    $maxWait = 90
    $waited = 0
    $isReady = $false

    while ($waited -lt $maxWait -and -not $isReady) {
        # -UseBasicParsing avoids the PS 5.1 "Script Execution Risk" prompt.
        try {
            $null = Invoke-WebRequest -Uri $url -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
            $isReady = $true
        }
        catch {
        }

        if (-not $isReady) {
            # Surface a server that died during startup instead of dotting for 90s.
            if ($job.State -ne "Running") {
                Write-Host ""
                Write-Host ""
                Write-Host "[ERROR] Server exited during startup. Output:" -ForegroundColor Red
                Receive-Job -Job $job
                Write-Host ""
                Write-Host "Try running 'pnpm run build' in $repoPath" -ForegroundColor Yellow
                return
            }
            Start-Sleep -Seconds 1
            $waited++
            Write-Host "." -NoNewline -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host ""

    if ($isReady) {
        Write-Host "[OK] Server is ready!" -ForegroundColor Green
        Write-Host "Opening browser at $url..." -ForegroundColor Cyan
    }
    else {
        Write-Host "[TIMEOUT] Opening browser anyway..." -ForegroundColor Yellow
    }
    Start-Process $url

    Write-Host ""
    Write-Host "DeepSeek Harness is running!" -ForegroundColor Green
    Write-Host "URL: $url" -ForegroundColor Cyan
    Write-Host "Close this window to stop the server." -ForegroundColor Gray
    Write-Host "============================================================" -ForegroundColor Gray
    Write-Host ""

    # Receive-Job without -Wait is non-blocking on PS 5.1 (-NoWait does not
    # exist there), so this streams server output as it arrives.
    while ($job.State -eq "Running") {
        Receive-Job -Job $job
        Start-Sleep -Milliseconds 500
    }
    Receive-Job -Job $job
}
catch {
    Write-Host ""
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
}
finally {
    Pop-Location -ErrorAction SilentlyContinue
}
