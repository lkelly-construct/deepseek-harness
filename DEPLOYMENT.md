# Deployment Guide: Share DeepSeek Harness with Your Team

This guide explains how to share your fully-configured DeepSeek Harness setup with coworkers.

## Option 1: Git Clone (Recommended for Teams)

**Best for:** Team workflows, shared development, version control

### Share via Git:

1. **Push to your Git repository:**
   ```powershell
   cd "C:\Users\lkelly\OneDrive - Corvus Construction\Desktop\Repo\deepseek-harness"
   git add .
   git commit -m "Add DeepSeek Harness setup with launcher and documentation"
   git push origin master
   ```

2. **Coworker clones:**
   ```powershell
   git clone https://github.com/your-org/deepseek-harness.git
   cd deepseek-harness
   ```

3. **Coworker runs setup:**
   ```powershell
   pnpm install
   pnpm run build
   .\setup-launcher.bat
   ```

4. **Coworker reads and follows:**
   - Open `ONBOARDING.md` for configuration
   - Add their OpenRouter/DeepSeek API keys
   - Double-click Desktop shortcut to launch

**Time to Deploy:** ~20 minutes (mostly waiting for build)

---

## Option 2: File Share / Cloud Storage

**Best for:** Quick sharing without Git infrastructure

### Share Steps:

1. **Zip the repository:**
   ```powershell
   cd C:\Users\lkelly\OneDrive
   Compress-Archive -Path "Corvus Construction\Desktop\Repo\deepseek-harness" -DestinationPath "deepseek-harness-setup.zip"
   ```

2. **Share the zip file:**
   - Email
   - OneDrive/Google Drive
   - Slack
   - Any file sharing service

3. **Coworker extracts & runs:**
   ```powershell
   # Extract zip
   Expand-Archive -Path "deepseek-harness-setup.zip" -DestinationPath "C:\repos\"
   cd "C:\repos\deepseek-harness"

   # Install & build
   pnpm install
   pnpm run build

   # Create launcher
   .\setup-launcher.bat
   ```

**Time to Deploy:** ~20 minutes

**Caveat:** Zip file is ~500MB (because node_modules is included). Better to share without node_modules:

```powershell
# Create zip WITHOUT node_modules:
$exclude = @('node_modules', '.git', 'dist', 'lib', '.pnpm-store')
Compress-Archive -Path "deepseek-harness\*" -DestinationPath "deepseek-harness-clean.zip" -Exclude $exclude
```

---

## Option 3: Quick Setup Batch File

**Best for:** One-command setup for non-technical users

Create a single `.bat` file that does everything:

```batch
@echo off
REM Deploy DeepSeek Harness

echo Installing Node.js dependencies...
cd /d "%~dp0"
pnpm install

echo Building project...
pnpm run build

echo Creating Desktop launcher...
setup-launcher.bat

echo Done! Look for "DeepSeek Harness" on your Desktop
pause
```

Save as `deploy.bat` in the repo root. Coworker just double-clicks it.

---

## Option 4: Documented Walkthrough (Manual)

**Best for:** Teaching & transparency

### Create a step-by-step guide:

1. **Prerequisites Check:**
   ```powershell
   node --version  # Should be 22.19 or 24+
   pnpm --version  # Should be 11.7.0
   ```

2. **Clone & Install:**
   ```powershell
   git clone <repo-url> deepseek-harness
   cd deepseek-harness
   pnpm install
   pnpm run build
   ```

3. **Create Launcher:**
   - Run: `setup-launcher.bat`
   - Look for "DeepSeek Harness" on Desktop

4. **Configure API Keys:**
   - Open the app (click desktop shortcut)
   - Go to Settings → Models
   - Add your OpenRouter/DeepSeek keys
   - Click Apply

5. **Start Using:**
   - Select model & provider
   - Type prompt
   - Chat with agent

---

## Pre-Deploy Checklist

Before sharing, make sure:

✅ All dependencies installed: `pnpm install`
✅ Project builds: `pnpm run build`
✅ Launcher works: double-click shortcut on Desktop
✅ Documentation is clear: review `ONBOARDING.md`
✅ No sensitive data in repo:
   ```powershell
   # Make sure .env is NOT committed
   git status  # Should not show .env
   ```
✅ `.gitignore` has `.env` and `node_modules`

---

## Configuration Management

### Sharing Settings (Optional)

Your provider configuration (OpenRouter, DeepSeek, etc.) is stored in:
```
~/.dsh/profiles/web/profile.yaml
```

To share configuration:
1. Copy this file
2. Coworker puts it in their `~/.dsh/profiles/web/` directory
3. Settings automatically load

**WARNING:** Remove API keys before sharing! Replace with placeholder:
```yaml
openrouter:
  apiKeyEnv: OPENROUTER_API_KEY  # They add their own key
```

---

## Troubleshooting Deployment

### "pnpm: command not found"
```powershell
npm install -g pnpm@11.7.0
```

### "Node version mismatch"
- Download Node.js 22+ or 24+ from https://nodejs.org
- Reinstall after upgrading Node

### Build fails
```powershell
# Clear and rebuild
rm -r node_modules pnpm-lock.yaml
pnpm install
pnpm run build
```

### Shortcut doesn't work
- Verify `start-dsh.ps1` exists in repo root
- Verify `deepseek-official.ico` exists
- Run `setup-launcher.bat` again

---

## What Gets Deployed

```
deepseek-harness/
├── Desktop Shortcut         → Launches server & browser
├── ONBOARDING.md            → Setup instructions
├── DEPLOYMENT.md            → This file
├── start-dsh.ps1            → PowerShell launcher
├── deepseek-official.ico    → Icon for shortcut
├── pnpm-lock.yaml           → Pinned dependencies
├── apps/web                 → Web UI
├── apps/cli                 → CLI
├── packages/                → 100+ plugin packages
├── docs/                    → Documentation
└── CLAUDE.md               → Project notes
```

**Size:** ~2GB installed (with node_modules)

---

## Security Considerations

1. **Never commit API keys** — use `.env` (in `.gitignore`)
2. **Rotate keys periodically** — especially shared dev keys
3. **Use .gitignore:**
   ```
   .env
   .env.local
   node_modules
   .pnpm-store
   dist
   lib
   .DS_Store
   ```

4. **For team keys:**
   - Use a secrets management tool (1Password, HashiCorp Vault, etc.)
   - Or use environment variable injection at deploy time

---

## Next Steps

1. **Choose your deployment method** (Git recommended for teams)
2. **Share this repo** with your coworker
3. **Coworker follows ONBOARDING.md**
4. **Both of you are now running DeepSeek Harness!** 🚀

---

## Questions?

- See `docs/development.md` for architecture details
- See `ONBOARDING.md` for user setup
- See individual package READMEs in `packages/` for plugin details
