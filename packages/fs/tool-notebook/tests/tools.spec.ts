import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolNotebook from '@deepseek-ai/dsh-tool-notebook'

const contexts: Context[] = []
const roots: string[] = []
let callNumber = 0

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function agent(ctx: Context, cwd: string): Agent {
  const id = SessionId(`tool-notebook-owner-${callNumber}`)
  const scope = ctx.plugin(() => {})
  const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd })
  const value: Agent = {
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function call(ctx: Context, owner: Agent | undefined, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`notebook-${++callNumber}`),
    name: 'notebook_edit',
    arguments: args,
    ...owner === undefined ? {} : { agent: owner },
  })
}

async function setup(config: ToolNotebook.Config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-notebook-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  const fiber = await ctx.plugin(ToolNotebook, config)
  return { ctx, root, fiber, owner: agent(ctx, root) }
}

function notebookJson(cells: Array<{ cell_type: string; source: string[] }>): string {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: cells.map(cell => ({ ...cell, metadata: {} })),
  }, null, 1)
}

describe('tool-notebook', () => {
  it('registers the standalone schema and configurable description', async () => {
    const { ctx, fiber } = await setup({ description: 'custom notebook description' })
    expect(ctx.tools.schemas().map(item => item.name)).toEqual(['notebook_edit'])
    expect(ctx.tools.schemas()[0]?.description).toBe('custom notebook description')
    expect(ctx.tools.get('notebook_edit')?.presentCall?.({
      command: 'read',
      path: '/workspace/a.ipynb',
    })).toMatchObject({ card: 'generic', kind: 'read', locations: [{ path: '/workspace/a.ipynb' }] })
    await fiber.dispose()
  })

  it('reads an overview of every cell, then one cell in full', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, notebookJson([
      { cell_type: 'markdown', source: ['# Title\n'] },
      { cell_type: 'code', source: ['print(1)\n', 'print(2)'] },
    ]))
    const overview = await call(ctx, owner, { command: 'read', path: sample })
    expect(text(overview)).toContain('2 cell(s)')
    expect(text(overview)).toContain('0\tmarkdown\t# Title')
    expect(text(overview)).toContain('1\tcode\tprint(1)')

    const cell = await call(ctx, owner, { command: 'read', path: sample, index: 1 })
    expect(text(cell)).toBe(`Cell 1 (code) of ${sample}:\nprint(1)\nprint(2)\n`)
  })

  it('inserts a cell at the given position and appends when index equals the cell count', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, notebookJson([
      { cell_type: 'code', source: ['first'] },
    ]))
    await call(ctx, owner, { command: 'insert', path: sample, index: 0, cell_type: 'markdown', source: '# Header' })
    const afterInsert = JSON.parse(await readFile(sample, 'utf8')) as { cells: Array<{ cell_type: string; source: string[] }> }
    expect(afterInsert.cells).toHaveLength(2)
    expect(afterInsert.cells[0]).toMatchObject({ cell_type: 'markdown', source: ['# Header'] })
    expect(afterInsert.cells[1]).toMatchObject({ cell_type: 'code', source: ['first'] })

    await call(ctx, owner, { command: 'insert', path: sample, index: 2, source: 'last' })
    const afterAppend = JSON.parse(await readFile(sample, 'utf8')) as { cells: unknown[] }
    expect(afterAppend.cells).toHaveLength(3)
  })

  it('defaults inserted cells to code type and gives them empty outputs', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, notebookJson([]))
    await call(ctx, owner, { command: 'insert', path: sample, index: 0, source: 'x = 1' })
    const doc = JSON.parse(await readFile(sample, 'utf8')) as {
      cells: Array<{ cell_type: string; outputs?: unknown; execution_count?: unknown }>
    }
    expect(doc.cells[0]).toMatchObject({ cell_type: 'code', outputs: [], execution_count: null })
  })

  it('replaces a cell\'s source and preserves its type by default', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, notebookJson([
      { cell_type: 'code', source: ['old'] },
    ]))
    const result = await call(ctx, owner, { command: 'replace', path: sample, index: 0, source: 'new = 1' })
    expect(text(result)).toBe(`Cell 0 replaced in ${sample}.`)
    const doc = JSON.parse(await readFile(sample, 'utf8')) as { cells: Array<{ cell_type: string; source: string[] }> }
    expect(doc.cells[0]).toMatchObject({ cell_type: 'code', source: ['new = 1'] })
  })

  it('replaces a cell\'s type and drops the stale code-only fields when converting away from code', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, notebookJson([
      { cell_type: 'code', source: ['old'] },
    ]))
    await call(ctx, owner, { command: 'replace', path: sample, index: 0, cell_type: 'markdown', source: '# Now markdown' })
    const doc = JSON.parse(await readFile(sample, 'utf8')) as { cells: Array<Record<string, unknown>> }
    expect(doc.cells[0]?.['cell_type']).toBe('markdown')
    expect(doc.cells[0]).not.toHaveProperty('outputs')
    expect(doc.cells[0]).not.toHaveProperty('execution_count')
  })

  it('deletes a cell', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, notebookJson([
      { cell_type: 'code', source: ['keep'] },
      { cell_type: 'code', source: ['drop'] },
    ]))
    const result = await call(ctx, owner, { command: 'delete', path: sample, index: 1 })
    expect(text(result)).toBe(`Cell 1 deleted from ${sample}.`)
    const doc = JSON.parse(await readFile(sample, 'utf8')) as { cells: Array<{ source: string[] }> }
    expect(doc.cells).toHaveLength(1)
    expect(doc.cells[0]).toMatchObject({ source: ['keep'] })
  })

  it('round-trips all four commands against one real notebook', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, notebookJson([
      { cell_type: 'code', source: ['a = 1'] },
    ]))
    await call(ctx, owner, { command: 'insert', path: sample, index: 1, source: 'b = 2' })
    await call(ctx, owner, { command: 'replace', path: sample, index: 0, source: 'a = 100' })
    await call(ctx, owner, { command: 'delete', path: sample, index: 1 })
    const final = await call(ctx, owner, { command: 'read', path: sample })
    expect(text(final)).toContain('1 cell(s)')
    const doc = JSON.parse(await readFile(sample, 'utf8')) as { cells: Array<{ source: string[] }> }
    expect(doc.cells).toEqual([{ cell_type: 'code', source: ['a = 100'], metadata: {} }])
  })

  it('reports malformed JSON as a clear tool error instead of crashing', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, '{ not json')
    const result = await call(ctx, owner, { command: 'read', path: sample })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not valid JSON')
  })

  it('reports a JSON file with no cells array as a clear tool error', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, JSON.stringify({ nbformat: 4 }))
    const result = await call(ctx, owner, { command: 'read', path: sample })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('missing a top-level `cells` array')
  })

  it('reports a missing notebook file', async () => {
    const { ctx, root, owner } = await setup()
    const result = await call(ctx, owner, { command: 'read', path: join(root, 'missing.ipynb') })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('does not exist')
  })

  it('rejects an out-of-range index for read, replace, and delete', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, notebookJson([{ cell_type: 'code', source: ['x'] }]))
    for (const command of ['read', 'replace', 'delete'] as const) {
      const args = command === 'replace'
        ? { command, path: sample, index: 5, source: 'y' }
        : { command, path: sample, index: 5 }
      const result = await call(ctx, owner, args)
      expect(result.isError, command).toBe(true)
      expect(text(result), command).toContain('Invalid `index`')
    }
  })

  it('requires index for insert, replace, and delete', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, notebookJson([{ cell_type: 'code', source: ['x'] }]))
    for (const command of ['insert', 'replace', 'delete'] as const) {
      const result = await call(ctx, owner, { command, path: sample })
      expect(result.isError, command).toBe(true)
      expect(text(result), command).toContain('`index` is required')
    }
  })

  it('rejects an invalid cell_type at the schema layer', async () => {
    const { ctx, root, owner } = await setup()
    const sample = join(root, 'a.ipynb')
    await writeFile(sample, notebookJson([{ cell_type: 'code', source: ['x'] }]))
    const result = await call(ctx, owner, { command: 'insert', path: sample, index: 0, cell_type: 'sql', source: 'x' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('invalid arguments')
  })
})
