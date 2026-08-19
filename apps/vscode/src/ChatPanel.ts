import * as vscode from 'vscode'
import { DshSession } from './DshSession'
import { openInEditor, showProposedDiff } from './fileDiff'

/** Messages the bridge script posts to the extension host. */
interface OpenFileMessage {
  type: 'dsh.openFile'
  path: string
  line?: number
}

interface ShowDiffMessage {
  type: 'dsh.showDiff'
  path: string
  before: string
  title: string
}

type BridgeMessage = OpenFileMessage | ShowDiffMessage

/**
 * VS Code WebviewPanel that wraps the DSH web UI in an iframe. A small bridge
 * script injected into the webview intercepts file-link clicks and proposed-edit
 * events from the DSH UI, forwarding them to the extension host via postMessage
 * so VS Code APIs (openTextDocument, vscode.diff) can be used.
 */
export class ChatPanel {
  private readonly panel: vscode.WebviewPanel

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly session: DshSession,
    private readonly cwd: string,
    private onDisposeCallback: () => void,
  ) {
    this.panel = panel
    this.panel.webview.html = this.buildHtml()

    this.panel.webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleMessage(raw as BridgeMessage)
    })

    this.panel.onDidDispose(() => {
      this.onDisposeCallback()
    })
  }

  static create(
    session: DshSession,
    cwd: string,
    onDispose: () => void,
  ): ChatPanel {
    const panel = vscode.window.createWebviewPanel(
      'dshChat',
      'DSH Chat',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    )
    return new ChatPanel(panel, session, cwd, onDispose)
  }

  reveal(): void {
    this.panel.reveal(undefined, true)
  }

  private async handleMessage(msg: BridgeMessage): Promise<void> {
    if (msg.type === 'dsh.openFile') {
      await openInEditor(msg.path, this.cwd, msg.line)
    } else if (msg.type === 'dsh.showDiff') {
      await showProposedDiff(msg.path, this.cwd, msg.before, msg.title)
    }
  }

  /**
   * Build the webview HTML. The page loads the DSH web UI in an iframe and
   * injects a bridge script that:
   *   - Intercepts clicks on [data-dsh-path] file links
   *   - Listens for `dsh:editProposal` CustomEvents from the DSH UI
   *
   * The DSH web UI emits `dsh:editProposal` events when it wants the host IDE
   * to show a diff before applying an edit. Add the following in the DSH client
   * to wire the other side:
   *   window.dispatchEvent(new CustomEvent('dsh:editProposal', {
   *     detail: { path, before, title }
   *   }))
   */
  private buildHtml(): string {
    const origin = this.session.origin
    // nonce for the bridge script; the iframe itself is not nonce-gated
    const nonce = crypto.randomUUID().replace(/-/g, '')

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    frame-src ${origin};
    script-src 'nonce-${nonce}';
    style-src 'unsafe-inline';
  ">
  <style>
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; display: block; }
  </style>
</head>
<body>
  <iframe id="dsh" src="${origin}" allow="clipboard-read; clipboard-write"></iframe>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi()
    const iframe = document.getElementById('dsh')

    // File link clicks: DSH renders file paths with data-dsh-path and
    // optionally data-dsh-line. Clicks bubble up through the iframe's
    // postMessage channel when the web UI posts them.
    window.addEventListener('message', (event) => {
      if (event.origin !== ${JSON.stringify(origin)}) return
      const msg = event.data
      if (msg && msg.type === 'dsh.openFile') {
        vscode.postMessage({ type: 'dsh.openFile', path: msg.path, line: msg.line })
      } else if (msg && msg.type === 'dsh.showDiff') {
        vscode.postMessage({ type: 'dsh.showDiff', path: msg.path, before: msg.before, title: msg.title })
      }
    })

    // CustomEvent bridge: the DSH iframe can fire events on its window that
    // bubble here if the same page structure is used in the iframe context.
    // This wires up the dsh:editProposal path for future DSH client changes.
    window.addEventListener('dsh:editProposal', (event) => {
      const detail = event.detail
      if (detail) {
        vscode.postMessage({ type: 'dsh.showDiff', path: detail.path, before: detail.before, title: detail.title })
      }
    })
  </script>
</body>
</html>`
  }
}
