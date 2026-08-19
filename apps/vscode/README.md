# dsh-vscode

VS Code extension that opens the DeepSeek Harness web UI inside a side panel
and adds native VS Code integration for file navigation and diff review.

## What it does

- **DSH: Open Chat** — spawns `dsh web` in the current workspace folder and
  opens the DSH web UI in a VS Code side panel (WebviewPanel).
- **DSH: Restart Server** — kills and restarts the `dsh web` subprocess.
- **File links** — clicking a file path in the DSH UI opens the file in the VS
  Code editor at the correct line (requires the DSH web UI to emit
  `window.postMessage({ type: 'dsh.openFile', path, line })` from the iframe).
- **Edit diffs** — when DSH proposes a file edit, it can trigger the VS Code
  diff editor (requires the DSH web UI to emit
  `window.dispatchEvent(new CustomEvent('dsh:editProposal', { detail: { path, before, title } }))`).

## Building

```
cd apps/vscode
npm install
npm run build
```

The compiled extension entry point is `out/extension.js`. Package with
`vsce package` to produce a `.vsix` for distribution.

## Requirements

- `dsh` on `PATH` (the DeepSeek Harness CLI).
- VS Code ≥ 1.80.

## Architecture

```
extension.ts      activate/deactivate, command registration
DshSession.ts     spawn dsh web, parse readiness port from stdout
ChatPanel.ts      WebviewPanel + iframe to http://127.0.0.1:<port>
fileDiff.ts       openInEditor, showProposedDiff, dsh-before: provider
```

The bridge between the iframe and the extension host uses
`window.postMessage` / `webview.onDidReceiveMessage`. The iframe posts
`dsh.openFile` / `dsh.showDiff` messages; the extension host resolves paths
and calls VS Code APIs.

## DSH client wiring (future)

For file links to work, add to the DSH web client wherever file paths are
rendered as clickable elements:

```ts
window.parent.postMessage({ type: 'dsh.openFile', path: resolvedPath, line }, '*')
```

For diff preview before edits:

```ts
window.parent.postMessage({ type: 'dsh.showDiff', path, before: originalContent, title: `Edit: ${basename}` }, '*')
```
