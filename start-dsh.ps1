$ErrorActionPreference = "Continue"

try {
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host "  DeepSeek Harness Launcher" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host ""

    $repoPath = "C:\Users\lkelly\OneDrive - Corvus Construction\Desktop\Repo\deepseek-harness"
    $url = "http://127.0.0.1:3080"

    Write-Host "Repository: $repoPath" -ForegroundColor Gray

    if (-not (Test-Path $repoPath)) {
        throw "Repository path not found: $repoPath"
    }

    Push-Location $repoPath

    Write-Host "Checking pnpm..." -ForegroundColor Yellow
    $pnpmCheck = & pnpm --version 2>&1
    Write-Host "  pnpm version: $pnpmCheck" -ForegroundColor Green

    Write-Host ""
    Write-Host "Launching pnpm dsh web..." -ForegroundColor Cyan
    Write-Host "Waiting for server to be ready..." -ForegroundColor Gray
    Write-Host ""

    $job = Start-Job -ScriptBlock {
        Set-Location "C:\Users\lkelly\OneDrive - Corvus Construction\Desktop\Repo\deepseek-harness"
        & pnpm dsh web 2>&1
    }

    $maxWait = 60
    $waited = 0
    $isReady = $false

    while ($waited -lt $maxWait -and -not $isReady) {
        try {
            $response = Invoke-WebRequest -Uri $url -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
            $isReady = $true
        }
        catch {
        }

        if (-not $isReady) {
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
        Start-Process $url
        Start-Sleep -Seconds 2
    }
    else {
        Write-Host "[TIMEOUT] Opening browser anyway..." -ForegroundColor Yellow
        Start-Process $url
        Start-Sleep -Seconds 2
    }

    Write-Host ""
    Write-Host "DeepSeek Harness is running!" -ForegroundColor Green
    Write-Host "URL: $url" -ForegroundColor Cyan
    Write-Host "Showing server output below:" -ForegroundColor Gray
    Write-Host "============================================================" -ForegroundColor Gray
    Write-Host ""

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
