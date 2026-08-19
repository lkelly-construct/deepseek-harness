/**
 * Model-facing cell-indexed `notebook_edit` over the Harness filesystem seam.
 * @module @deepseek-ai/dsh-tool-notebook
 */

import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import { sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'

const DEFAULT_DESCRIPTION = `
Read, insert, replace, or delete cells in a Jupyter notebook (.ipynb) file, indexed by zero-based cell position.
* \`read\` with no \`index\` returns an overview of every cell (index, type, first line); with \`index\` returns that cell's full source.
* \`insert\` adds a new cell of \`cell_type\` before the cell currently at \`index\` (or appends when \`index\` equals the cell count).
* \`replace\` overwrites the source of the cell at \`index\`, optionally also changing its \`cell_type\`.
* \`delete\` removes the cell at \`index\`.
`.trim()

/** Minimal nbformat v4 shape this tool reads and preserves verbatim outside the touched cell. */
interface NotebookCell {
  cell_type: string
  source: string[] | string
  metadata: Record<string, unknown>
  [key: string]: unknown
}

interface NotebookDocument {
  cells: NotebookCell[]
  [key: string]: unknown
}

/** Split a cell's full text into nbformat's list-of-lines source form (each line keeps its trailing `\n` except the last). */
function toSourceLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  return lines.map((line, index) => index < lines.length - 1 ? `${line}\n` : line)
}

/** Join a cell's `source` (either list-of-lines or a single string) back into one text blob. */
function fromSourceLines(source: string[] | string): string {
  return Array.isArray(source) ? source.join('') : source
}

/** Parse notebook JSON, failing with a model-readable message instead of an uncaught parse exception. */
function parseNotebook(content: string, displayPath: string): NotebookDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error: unknown) {
    throw new Error(`The file ${displayPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`The file ${displayPath} is not a notebook: the top level must be a JSON object.`)
  }
  const cells = (parsed as Record<string, unknown>)['cells']
  if (!Array.isArray(cells)) {
    throw new Error(`The file ${displayPath} is not a notebook: missing a top-level \`cells\` array.`)
  }
  for (const [index, cell] of cells.entries()) {
    if (typeof cell !== 'object' || cell === null || Array.isArray(cell)) {
      throw new Error(`The file ${displayPath} is not a notebook: cell ${index} is not an object.`)
    }
    const cellType = (cell as Record<string, unknown>)['cell_type']
    if (typeof cellType !== 'string') {
      throw new Error(`The file ${displayPath} is not a notebook: cell ${index} has no string \`cell_type\`.`)
    }
    const source = (cell as Record<string, unknown>)['source']
    if (typeof source !== 'string' && !(Array.isArray(source) && source.every(line => typeof line === 'string'))) {
      throw new Error(`The file ${displayPath} is not a notebook: cell ${index} has no valid \`source\`.`)
    }
  }
  return parsed as NotebookDocument
}

function requireIndex(index: number | undefined, command: string): number {
  if (index === undefined) throw new Error(`Parameter \`index\` is required for command: ${command}`)
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid \`index\`: ${index}. It must be a non-negative integer.`)
  }
  return index
}

function requireExistingIndex(index: number, cellCount: number, command: string): void {
  if (index >= cellCount) {
    throw new Error(
      `Invalid \`index\`: ${index}. Command \`${command}\` requires an existing cell; the notebook has ${cellCount} cell(s) (indices 0-${Math.max(0, cellCount - 1)}).`,
    )
  }
}

function cellPreview(cell: NotebookCell): string {
  const text = fromSourceLines(cell.source)
  const firstLine = text.split('\n', 1)[0] ?? ''
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine
}

function readNotebook(notebook: NotebookDocument, path: string, index: number | undefined): string {
  if (index === undefined) {
    if (notebook.cells.length === 0) return `The notebook ${path} has no cells.`
    const rows = notebook.cells.map((cell, cellIndex) => `${cellIndex}\t${cell.cell_type}\t${cellPreview(cell)}`)
    return `Here are the ${notebook.cells.length} cell(s) in ${path} (index, type, first line):\n${rows.join('\n')}\n`
  }
  requireExistingIndex(index, notebook.cells.length, 'read')
  const cell = notebook.cells[index] as NotebookCell
  return `Cell ${index} (${cell.cell_type}) of ${path}:\n${fromSourceLines(cell.source)}\n`
}

class MutationPolicy {
  private readonly policy: SandboxPolicyService | undefined

  constructor(ctx: Context) {
    this.policy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
    if (ctx.fs.sandboxMode !== undefined && this.policy === undefined) {
      throw new Error('tool-notebook: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
  }

  resolve(exec: ToolRunContext): SandboxExecutionPolicy | undefined {
    return this.policy?.resolve({
      ...exec.agent === undefined ? {} : { session: exec.agent.session },
    })
  }

  mapError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown {
    if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
    const mode = (policy as SandboxExecutionPolicy).mode
    return new FsError(sandboxDenialMarker(mode), 'FS_SANDBOX_DENIED', { cause: error })
  }
}

async function resolveTarget(ctx: Context, path: string, signal: AbortSignal): Promise<FsTarget> {
  if (path.trim().length === 0) throw new Error('path must be a non-empty string')
  if (!isAbsolute(path)) {
    throw new Error(`The path ${path} is not an absolute path, it should start with \`/\`. Maybe you meant /${path}?`)
  }
  return ctx.fs.resolve(path, { signal })
}

async function loadNotebook(
  ctx: Context,
  target: FsTarget,
  exec: ToolRunContext,
): Promise<{ notebook: NotebookDocument; version: FsVersion }> {
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`The path ${target.displayPath} does not exist. Please provide a valid path.`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  const content = await ctx.fs.readText(target, exec.signal)
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return { notebook: parseNotebook(content, target.displayPath), version: info.version }
}

async function writeNotebook(
  ctx: Context,
  policy: MutationPolicy,
  target: FsTarget,
  notebook: NotebookDocument,
  expected: FsWriteIntent,
  exec: ToolRunContext,
): Promise<void> {
  const sandboxPolicy = policy.resolve(exec)
  let outcome
  try {
    outcome = await ctx.fs.writeText(target, JSON.stringify(notebook, null, 1), expected, exec.signal, sandboxPolicy)
  } catch (error: unknown) {
    throw policy.mapError(error, sandboxPolicy)
  }
  ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
}

async function insertCell(
  ctx: Context,
  policy: MutationPolicy,
  path: string,
  index: number | undefined,
  cellType: string | undefined,
  source: string | undefined,
  exec: ToolRunContext,
): Promise<string> {
  const target = await resolveTarget(ctx, path, exec.signal)
  const at = requireIndex(index, 'insert')
  const type = cellType ?? 'code'
  if (type !== 'code' && type !== 'markdown' && type !== 'raw') {
    throw new Error(`Invalid \`cell_type\`: ${JSON.stringify(cellType)}. It must be one of \`code\`, \`markdown\`, \`raw\`.`)
  }
  const { notebook, version } = await loadNotebook(ctx, target, exec)
  if (at > notebook.cells.length) {
    throw new Error(
      `Invalid \`index\`: ${at}. Command \`insert\` accepts an index up to the cell count (${notebook.cells.length}) to append.`,
    )
  }
  const cell: NotebookCell = {
    cell_type: type,
    source: toSourceLines(source ?? ''),
    metadata: {},
    ...type === 'code' ? { outputs: [], execution_count: null } : {},
  }
  notebook.cells.splice(at, 0, cell)
  await writeNotebook(ctx, policy, target, notebook, { kind: 'replaceIfVersion', version }, exec)
  return `Cell inserted at index ${at} in ${target.displayPath}.`
}

async function replaceCell(
  ctx: Context,
  policy: MutationPolicy,
  path: string,
  index: number | undefined,
  cellType: string | undefined,
  source: string | undefined,
  exec: ToolRunContext,
): Promise<string> {
  const target = await resolveTarget(ctx, path, exec.signal)
  const at = requireIndex(index, 'replace')
  if (source === undefined) throw new Error('Parameter `source` is required for command: replace')
  if (cellType !== undefined && cellType !== 'code' && cellType !== 'markdown' && cellType !== 'raw') {
    throw new Error(`Invalid \`cell_type\`: ${JSON.stringify(cellType)}. It must be one of \`code\`, \`markdown\`, \`raw\`.`)
  }
  const { notebook, version } = await loadNotebook(ctx, target, exec)
  requireExistingIndex(at, notebook.cells.length, 'replace')
  const current = notebook.cells[at] as NotebookCell
  const nextType = cellType ?? current.cell_type
  const changedType = nextType !== current.cell_type
  notebook.cells[at] = {
    ...current,
    cell_type: nextType,
    source: toSourceLines(source),
    ...changedType && nextType === 'code' ? { outputs: [], execution_count: null } : {},
    ...changedType && nextType !== 'code' ? { outputs: undefined, execution_count: undefined } : {},
  }
  // Drop cleared keys rather than serializing them as null/undefined.
  const replaced = notebook.cells[at] as Record<string, unknown>
  if (replaced['outputs'] === undefined) delete replaced['outputs']
  if (replaced['execution_count'] === undefined) delete replaced['execution_count']
  await writeNotebook(ctx, policy, target, notebook, { kind: 'replaceIfVersion', version }, exec)
  return `Cell ${at} replaced in ${target.displayPath}.`
}

async function deleteCell(
  ctx: Context,
  policy: MutationPolicy,
  path: string,
  index: number | undefined,
  exec: ToolRunContext,
): Promise<string> {
  const target = await resolveTarget(ctx, path, exec.signal)
  const at = requireIndex(index, 'delete')
  const { notebook, version } = await loadNotebook(ctx, target, exec)
  requireExistingIndex(at, notebook.cells.length, 'delete')
  notebook.cells.splice(at, 1)
  await writeNotebook(ctx, policy, target, notebook, { kind: 'replaceIfVersion', version }, exec)
  return `Cell ${at} deleted from ${target.displayPath}.`
}

function presentNotebookCall(args: {
  command: 'read' | 'insert' | 'replace' | 'delete'
  path: string
  index?: number
}): ToolCallView {
  const line = args.index === undefined ? undefined : args.index + 1
  switch (args.command) {
    case 'read':
      return { card: 'generic', title: `read ${args.path}`, kind: 'read', locations: [{ path: args.path, ...line === undefined ? {} : { line } }] }
    case 'insert':
      return { card: 'generic', title: `insert cell in ${args.path}`, kind: 'edit', locations: [{ path: args.path, ...line === undefined ? {} : { line } }] }
    case 'replace':
      return { card: 'generic', title: `replace cell in ${args.path}`, kind: 'edit', locations: [{ path: args.path, ...line === undefined ? {} : { line } }] }
    case 'delete':
      return { card: 'generic', title: `delete cell in ${args.path}`, kind: 'edit', locations: [{ path: args.path, ...line === undefined ? {} : { line } }] }
  }
}

interface ResolvedConfig {
  description: string
}

/** Register the model-facing `notebook_edit` tool. */
function registerNotebookEdit(ctx: Context, config: ResolvedConfig): void {
  const policy = new MutationPolicy(ctx)
  ctx.tools.register(defineTool({
    name: 'notebook_edit',
    description: config.description,
    parameters: {
      command: {
        type: 'string',
        required: true,
        enum: ['read', 'insert', 'replace', 'delete'],
        description: 'The command to run. Allowed options are: `read`, `insert`, `replace`, `delete`.',
      },
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path to the .ipynb file, e.g. `/repo/notebook.ipynb`.',
      },
      index: {
        type: 'integer',
        description: 'Zero-based cell index. Omit for `read` to get an overview of every cell. Required for `insert` (position to insert before; equal to the cell count to append), `replace`, and `delete`.',
      },
      cell_type: {
        type: 'string',
        enum: ['code', 'markdown', 'raw'],
        description: 'Cell type for `insert` (defaults to `code`) or to change the type of the cell `replace` targets.',
      },
      source: {
        type: 'string',
        description: 'Required parameter of `insert` and `replace`: the cell\'s full new source text.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      switch (args.command) {
        case 'read': {
          const target = await resolveTarget(ctx, args.path, exec.signal)
          const { notebook } = await loadNotebook(ctx, target, exec)
          return readNotebook(notebook, target.displayPath, args.index)
        }
        case 'insert':
          return insertCell(ctx, policy, args.path, args.index, args.cell_type, args.source, exec)
        case 'replace':
          return replaceCell(ctx, policy, args.path, args.index, args.cell_type, args.source, exec)
        case 'delete':
          return deleteCell(ctx, policy, args.path, args.index, exec)
      }
    },
    presentCall: presentNotebookCall,
  }))
}

export const name = 'tool-notebook'
export const inject = ['tools', 'fs']

/** Configuration for the notebook-editing tool. */
export interface Config {
  /** Model-facing tool description. */
  description?: string
}

/** Runtime configuration schema for the notebook-editing tool. */
export const Config: z<Config> = z.object({
  description: z.string().default(DEFAULT_DESCRIPTION),
})

/** Register one `notebook_edit` tool over `ctx.fs`. */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    description: config.description ?? DEFAULT_DESCRIPTION,
  }
  if (resolved.description.trim().length === 0) {
    throw new Error('tool-notebook: description must be non-empty')
  }
  registerNotebookEdit(ctx, resolved)
}
