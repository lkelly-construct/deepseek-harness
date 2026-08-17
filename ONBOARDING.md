# DeepSeek Harness Turnkey Setup

This is a complete, ready-to-run installation of **DeepSeek Harness** with pre-configured providers and a Desktop launcher.

## Prerequisites

- **Windows 11** (or Windows 10)
- **Node.js 22.19+** or **24+** (free download from https://nodejs.org)
- **Git 2.26+** (usually already installed)
- **OpenRouter API Key** (optional, for OpenRouter models)

## Quick Start (5 minutes)

### Step 1: Verify Prerequisites

Open PowerShell and run:
```powershell
node --version
git --version
```

Both should show version numbers. If not, install them first.

### Step 2: Install Dependencies

Navigate to the repo and run:
```powershell
cd "path\to\deepseek-harness"
pnpm install
pnpm run build
```

This takes 5-15 minutes and only needs to run once.

### Step 3: Create Desktop Launcher

Double-click this file to create the launcher shortcut:
```
setup-launcher.bat
```

You'll see a Desktop shortcut appear: **"DeepSeek Harness"**

### Step 4: Launch & Configure

1. **Double-click the "DeepSeek Harness" shortcut** on your Desktop
2. Browser opens to `http://127.0.0.1:3080`
3. Go to **Settings → Models → Add provider** to configure your API keys:
   - **OpenRouter** (if using OpenRouter)
   - **DeepSeek Direct** (if using DeepSeek's official API)
   - Other providers as needed

## Configuration

### OpenRouter (Recommended)

1. Get an API key from https://openrouter.ai
2. In Harness: **Settings → Models → openrouter**
3. Paste your key in **API key**
4. Models are pre-configured (DeepSeek V4 Flash, V4 Pro, etc.)
5. Click **Apply**

### DeepSeek Direct API

1. Get an API key from https://platform.deepseek.com
2. Set environment variable:
   ```powershell
   $env:DEEPSEEK_API_KEY = "your-key-here"
   ```
   Or create `.env` file in repo root:
   ```
   DEEPSEEK_API_KEY=sk-...
   ```
3. Restart the Harness (close and reopen the shortcut)

### Custom API Endpoint

1. **Settings → Models → Add provider**
2. Enter your custom endpoint details
3. Click **Apply**

## Using DeepSeek Harness

### Launch

Double-click **"DeepSeek Harness"** on your Desktop. The PowerShell window shows:
- Server starting up
- When it's ready: `[OK] Server is ready!`
- Browser opens automatically

### Create a Session

1. Type a prompt in the chat box
2. Select your model and provider
3. Click **Send**

### Stop the Server

Close the PowerShell window.

## Troubleshooting

### "pnpm: command not found"
```powershell
npm install -g pnpm@11.7.0
```

### Browser won't open
- Manual fix: open `http://127.0.0.1:3080` in your browser
- Check PowerShell window for error messages

### Model not found
- Confirm the model ID (left column in Settings)
- Check API key is valid
- Verify base URL if using custom provider

### Server crashes on startup
- Run `pnpm run build` in repo directory
- Check Node.js version: `node --version` (needs 22.19+ or 24+)

## Files & Folders

```
deepseek-harness/
├── start-dsh.ps1           # PowerShell launcher script
├── deepseek-official.ico   # Desktop icon
├── pnpm-lock.yaml          # Dependency lock file
├── apps/
│   ├── web/                # Web UI
│   └── cli/                # CLI interface
├── packages/               # Plugin packages
├── .env                    # API keys (create this, don't commit)
└── ONBOARDING.md          # This file
```

## Daily Workflow

```
1. Double-click "DeepSeek Harness" shortcut
   ↓
2. Browser opens to http://127.0.0.1:3080
   ↓
3. Chat with the agent
   ↓
4. Close PowerShell window to stop server
```

## Features

✅ **Web UI** — Beautiful chat interface
✅ **Multiple Models** — DeepSeek, OpenAI, OpenRouter, custom endpoints
✅ **Reasoning Support** — Extended thinking for complex tasks
✅ **Tool Use** — File operations, code execution, API calls
✅ **Session History** — Persistent conversations
✅ **Settings** — Configure models, API keys, plugins

## Getting Help

- **Architecture**: See `docs/architecture.md`
- **Development**: See `docs/development.md`
- **Plugins**: See `packages/README.md`
- **Issues**: Check GitHub discussions

## What's Next?

- Explore the **Settings** panel to configure your providers
- Try different models and reasoning levels
- Use the agent for coding, analysis, writing, and more
- Build custom plugins if needed (see `docs/development.md`)

---

**Happy Harness-ing!** 🚀
