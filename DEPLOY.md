# DeepSeek Harness - One-Click Deployment

## For Your Coworker: Complete Setup in One Click

**All you need:**
- Node.js 22.19+ installed (check: `node --version`)
- Git installed (check: `git --version`)
- Internet connection
- 25-30 minutes of wait time

Everything else — pnpm, dependencies, the build, the Desktop shortcut — is automatic.

## Quick Start (2 Steps)

### Step 1: Download and run the deployment script

Download **`DEPLOY-ONE-CLICK.bat`** from the repository and **double-click it**.

That is the only file you need. Do not download a `.ps1` — Windows blocks downloaded
PowerShell scripts by default, and this `.bat` is not subject to that restriction.

### Step 2: Wait (~25-30 minutes)

The script will automatically:

1. Verify Node.js and Git
2. Install pnpm if it is missing
3. Clone the repository
4. Install dependencies (`pnpm install`)
5. Build the project (`pnpm run build`)
6. Create the Desktop launcher

**Progress:**
- Minutes 0-1: Prerequisite checks
- Minutes 1-3: Cloning repo
- Minutes 3-6: Installing dependencies
- Minutes 6-25: Building project
- Minute 25+: Desktop shortcut created

Each step prints `[OK]` as it finishes. If a step fails it prints `[ERROR]` with the
specific fix and stops, rather than continuing into a broken state.

## When It's Done

The window shows:

```
============================================================
  SUCCESS - Setup Complete
============================================================
```

And a **"DeepSeek Harness"** shortcut appears on your Desktop.

## First Use

1. Double-click **"DeepSeek Harness"** on your Desktop
2. Wait for `[OK] Server is ready!` — your browser opens automatically
3. Go to **Settings > Models** and add your API key:
   - **OpenRouter**: https://openrouter.ai/settings/keys
   - **DeepSeek**: https://platform.deepseek.com
4. Click **Apply**, pick a model, and start chatting

### Adding an OpenRouter model

OpenRouter's site shows a friendly display name ("DeepSeek V4 Flash 0731") but the API
needs the **model ID** — the slug directly under the title, e.g. `deepseek/deepseek-v4-flash-0731`.

In **Settings > Models > openrouter**, each row takes both:

| Left field (model ID)             | Right field (display name) |
|-----------------------------------|----------------------------|
| `deepseek/deepseek-v4-flash-0731` | DeepSeek V4 Flash 0731     |

Putting the display name in the left field is the most common setup mistake and produces
`is not a valid model ID` or `has no configured model`.

Also confirm **Base URL** is `https://openrouter.ai/api/v1`.

## Afterward

Every day, just:
- Double-click "DeepSeek Harness" on Desktop
- Browser opens, app is ready to use
- Close the PowerShell window to stop the server

## Troubleshooting

**"Node.js not found"**
- Install Node.js 22.19+ from https://nodejs.org, then re-run the script

**"Git not found"**
- Install Git from https://git-scm.com, then re-run the script

**"Project is not built yet"**
- The build did not finish. Open PowerShell in the install folder and run:
  `pnpm install ; pnpm run build`

**"Server exited during startup"**
- The launcher prints the server's own output. Usually this means the build is
  incomplete — run `pnpm run build` in the install folder.

**Browser doesn't open**
- Open http://127.0.0.1:3080 manually
- Check the PowerShell window for errors

**Shortcut missing or folder was moved**
- Run `setup-launcher.bat` from the install folder. The shortcut always rebuilds
  itself against wherever the folder currently lives.

**Re-running the deployment script**
- Safe. It detects the existing checkout and skips the clone.

## Installation Location

Default: `%USERPROFILE%\DeepSeek-Harness` (e.g. `C:\Users\yourname\DeepSeek-Harness`)

If you move the folder, run `setup-launcher.bat` inside it to repoint the shortcut.

## What Gets Installed

```
%USERPROFILE%\DeepSeek-Harness\
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
**Effort:** Download one file, double-click, wait
**Result:** Full-featured DeepSeek Harness ready to use

Ready? Download `DEPLOY-ONE-CLICK.bat` and run it.
