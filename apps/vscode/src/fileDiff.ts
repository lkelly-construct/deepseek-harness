import * as vscode from 'vscode'
import * as path from 'node:path'

/**
 * Open a file in the VS Code editor, optionally jumping to a 1-based line.
 * Resolves relative paths against `cwd`.
 */
export async function openInEditor(filePath: string, cwd: string, line?: number): Promise<void> {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
  const uri = vscode.Uri.file(resolved)
  const doc = await vscode.workspace.openTextDocument(uri)
  const editor = await vscode.window.showTextDocument(doc, { preview: false })
  if (line !== undefined && line > 0) {
    const pos = new vscode.Position(line - 1, 0)
    editor.selection = new vscode.Selection(pos, pos)
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
  }
}

/**
 * Show a two-pane diff between `before` (in-memory) and the current on-disk
 * version of a file. Used when DSH proposes an edit before applying it.
 *
 * `title` appears in the diff tab header.
 */
export async function showProposedDiff(
  filePath: string,
  cwd: string,
  before: string,
  title: string,
): Promise<void> {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
  const rightUri = vscode.Uri.file(resolved)

  // Left side: in-memory snapshot of the file before the edit.
  const leftUri = rightUri.with({
    scheme: 'dsh-before',
    query: Buffer.from(before).toString('base64'),
  })

  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title)
}

/**
 * Register the `dsh-before:` virtual document provider so the left side of
 * showProposedDiff can be resolved by VS Code.
 */
export function registerDiffProvider(context: vscode.ExtensionContext): void {
  const provider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      try {
        return Buffer.from(uri.query, 'base64').toString('utf8')
      } catch {
        return ''
      }
    }
  })()
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('dsh-before', provider),
  )
}
