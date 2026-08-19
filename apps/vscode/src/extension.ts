import * as vscode from 'vscode'
import { DshSession } from './DshSession'
import { ChatPanel } from './ChatPanel'
import { registerDiffProvider } from './fileDiff'

export function activate(context: vscode.ExtensionContext): void {
  registerDiffProvider(context)

  let session: DshSession | undefined
  let panel: ChatPanel | undefined

  const openChat = vscode.commands.registerCommand('dsh.openChat', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (folder === undefined) {
      void vscode.window.showErrorMessage('DSH: Open a folder first.')
      return
    }

    if (panel !== undefined) {
      panel.reveal()
      return
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'DSH: Starting server…', cancellable: false },
      async () => {
        if (session === undefined) {
          session = new DshSession(folder.uri.fsPath)
          try {
            await session.start()
          } catch (err) {
            session.dispose()
            session = undefined
            void vscode.window.showErrorMessage(`DSH failed to start: ${String(err)}`)
            return
          }
        }

        panel = ChatPanel.create(session, folder.uri.fsPath, () => {
          panel = undefined
        })
      },
    )
  })

  const restartServer = vscode.commands.registerCommand('dsh.restartServer', async () => {
    if (session === undefined) {
      void vscode.window.showInformationMessage('DSH: No active server.')
      return
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'DSH: Restarting server…', cancellable: false },
      async () => {
        await session?.restart()
        void vscode.window.showInformationMessage('DSH: Server restarted.')
      },
    )
  })

  context.subscriptions.push(openChat, restartServer, {
    dispose: () => {
      session?.dispose()
      session = undefined
    },
  })
}

export function deactivate(): void {
  // Subscriptions are cleaned up by VS Code via context.subscriptions.
}
