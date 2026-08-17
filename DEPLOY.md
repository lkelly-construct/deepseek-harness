# DeepSeek Harness - One-Click Deployment

## For Your Coworker: Complete Setup in One Click

**All you need:**
- Node.js 22+ installed (check: `node --version`)
- Internet connection
- 25-30 minutes of wait time

## Quick Start (2 Steps)

### Step 1: Download the Deployment Script

Choose ONE of these:

**Option A: PowerShell (Recommended)**
- Download: `deploy-deepseek.ps1`
- Right-click → Run with PowerShell
- Answer any prompts with "Y"

**Option B: Batch File**
- Download: `DEPLOY-ONE-CLICK.bat`
- Double-click to run
- Wait for completion

### Step 2: Wait (~25-30 minutes)

The script will automatically:
1. ✅ Clone the repository
2. ✅ Install dependencies (pnpm install)
3. ✅ Build the project (pnpm run build)
4. ✅ Create Desktop launcher
5. ✅ Launch the app

**Progress:**
- Minutes 0-2: Cloning repo
- Minutes 2-5: Installing dependencies
- Minutes 5-20: Building project
- Minutes 20-22: Creating launcher
- Minute 22+: Browser opens automatically

## When It's Done

A PowerShell window will show:
```
============================================================
  SUCCESS! Setup Complete!
============================================================
```

And:
- **Desktop shortcut** appears: "DeepSeek Harness"
- **Browser opens** to http://127.0.0.1:3080
- **App is running!**

## First Use

1. Go to **Settings → Models**
2. Add your API key:
   - **OpenRouter**: https://openrouter.ai/api/keys
   - **DeepSeek**: https://platform.deepseek.com/api_keys
3. Click **Apply**
4. Select a model and start chatting!

## Afterward

Every day, just:
- Double-click "DeepSeek Harness" on Desktop
- Browser opens, app is ready to use
- Close the PowerShell window to stop

## Troubleshooting

**"Node not found"**
- Install Node.js 22+ from https://nodejs.org
- Restart the script

**"Git not found"**
- Install Git from https://git-scm.com
- Restart the script

**"Build failed"**
- Check your internet connection
- Try again (some packages timeout)

**Browser doesn't open**
- Manually open http://127.0.0.1:3080
- Check PowerShell window for errors

**Shortcut doesn't work**
- Right-click Desktop → Refresh
- If still missing, run `setup-launcher.bat` from the install folder

## Installation Location

Default: `C:\DeepSeek-Harness`

You can:
- Move the folder anywhere
- Delete it entirely (removes everything)
- Access it via PowerShell for advanced commands

## What Gets Installed

```
C:\DeepSeek-Harness\
├── Web UI (browser-based)
├── Server (runs locally)
└── All 100+ plugins & packages
```

Total size: ~2GB with dependencies

## Need Help?

Read:
- `ONBOARDING.md` — Detailed user guide
- `DEPLOYMENT.md` — Advanced setup options
- `docs/architecture.md` — How it works

---

**Total time:** ~25-30 minutes
**Effort:** Just click and wait
**Result:** Full-featured DeepSeek Harness ready to use

🚀 Ready? Download and run the script!
