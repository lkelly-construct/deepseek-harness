# Refresh %USERPROFILE%\.dsh\.env from the team's "corax" Vercel project
# (OpenRouter, Supabase, Supabase MCP token). Shared by DEPLOY-ONE-CLICK.bat's
# initial setup and start-dsh.ps1's every-launch refresh, so the two paths
# can't drift into different behavior.
#
# Best-effort by design: a failure here (offline, no project access, not
# logged in) must not block chatting with the app -- it only means the
# team-shared rows (right now: the supabase-mcp preset row) stay disabled
# until the next successful pull. Exits 0 on success, 1 otherwise; never
# throws past its own boundary.
#
# -AllowLogin permits an interactive `vercel login` (opens a browser) when
# not already authenticated. Pass it from the one-click deploy, where a
# browser sign-in is already the expected flow. Omit it for the every-launch
# call from start-dsh.ps1: an unauthenticated double-click of the Desktop
# shortcut should skip the refresh and open the app immediately, not sit
# there waiting on a sign-in nobody asked for right now.

param(
    [switch]$AllowLogin,
    [switch]$Quiet
)

$ErrorActionPreference = "Continue"

function Say($Message, $Color = "Gray") {
    if (-not $Quiet) { Write-Host $Message -ForegroundColor $Color }
}

$envPath = Join-Path $env:USERPROFILE ".dsh\.env"

$vercelCmd = Get-Command vercel -ErrorAction SilentlyContinue
if (-not $vercelCmd) {
    if (-not $AllowLogin) {
        Say "  [--] Vercel CLI not installed -- skipping team env refresh (run DEPLOY-ONE-CLICK.bat once to set it up)." Gray
        exit 1
    }
    Say "  [..] Vercel CLI not found. Installing..." Yellow
    npm install -g vercel *> $null
    if ($LASTEXITCODE -ne 0) {
        Say "  [!!] Could not install the Vercel CLI -- team env vars not refreshed." Red
        Say "       Ask a team member to copy $envPath from their machine." Gray
        exit 1
    }
    Say "  [OK] Vercel CLI installed" Green
}

vercel whoami *> $null
if ($LASTEXITCODE -ne 0) {
    if (-not $AllowLogin) {
        Say "  [--] Not logged into Vercel -- skipping team env refresh." Gray
        Say "       To refresh: vercel login ; vercel env pull `"$envPath`" --project corax --yes" Gray
        exit 1
    }
    Say "  [..] Not logged into Vercel. A browser window will open -- sign in with your Corvus Construction account." Yellow
    vercel login
    if ($LASTEXITCODE -ne 0) {
        Say "  [!!] Vercel login failed or was cancelled -- team env vars not refreshed." Red
        Say "       Re-run manually: vercel login ; vercel env pull `"$envPath`" --project corax --yes" Gray
        exit 1
    }
    Say "  [OK] Logged into Vercel" Green
}

vercel env pull $envPath --project corax --yes *> $null
if ($LASTEXITCODE -ne 0) {
    Say "  [!!] vercel env pull failed. Make sure your account has access to the `"corax`" project." Red
    Say "       Re-run manually: vercel env pull `"$envPath`" --project corax --yes" Gray
    exit 1
}
Say "  [OK] Team env vars refreshed: $envPath" Green
Say "       Includes: OpenRouter, Supabase (all projects), Supabase MCP token" Gray
exit 0
