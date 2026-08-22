/**
 * Consumer-surface tests for the typecheck tool over a FAKE subprocess service, exercised through
 * `ctx.tools.execute()` so nothing bypasses the tool registry. The fake service makes every spawn
 * outcome scriptable — clean exit, errors, spawn failure, abort kill — and records every spec, so
 * these tests verify schemas, cwd derivation, argv construction, signal forwarding, the
 * parse-to-LspDiagnostic conversion, and the no-network/no-seam isolation. The parser itself is
 * pinned separately against exact tsc output.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { pathToFileURL } from 'node:url'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessCollectedOutputs, SubprocessHandle, SubprocessOutcome, SubprocessOutputRead, SubprocessOutputReader, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import * as ToolTypecheck from '@deepseek-ai/dsh-tool-typecheck'
import { parseTscOutput, TYPECHECK_PROMPT_TEXT } from '@deepseek-ai/dsh-tool-typecheck'

const testToolSignal = new AbortController().signal

/** One scripted collect-mode stream, returned by `readFrom(0)` after settlement. */
interface ScriptedStream {
  text: string
}

/** One scripted spawn: exit facts plus the collected streams the tool reads. */
interface ScriptedRun {
  outcome: SubprocessOutcome
  stdout: ScriptedStream
  stderr: ScriptedStream
}

/** A successful tsc run over the given stdout; overrides script the failure shapes. */
function runResult(
  stdout: string,
  overrides?: Partial<SubprocessOutcome> & { stderr?: ScriptedStream },
): ScriptedRun {
  const { stderr, ...outcome } = overrides ?? {}
  return {
    outcome: { exitCode: 0, signal: null, ...outcome },
    stdout: { text: stdout },
    stderr: stderr ?? { text: '' },
  }
}

/** A fixed-response collect-mode reader: the tool reads each stream once, from 0, after settlement. */
class FakeReader implements SubprocessOutputReader {
  constructor(private readonly read: ScriptedStream) {}

  readFrom(_fromByte: number): SubprocessOutputRead {
    return {
      text: this.read.text,
      nextOffset: 0,
      lossy: false,
    }
  }
}

/** A scriptable subprocess handle: `done` resolves with the scripted outcome and records termination. */
class FakeHandle implements SubprocessHandle {
  readonly pid = 4242
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined
  readonly collected: SubprocessCollectedOutputs
  readonly done: Promise<SubprocessOutcome>
  terminated = false

  constructor(spec: SubprocessSpawnSpec, script: () => ScriptedRun | { reject: Error }) {
    spec.signal?.addEventListener('abort', () => { this.terminated = true }, { once: true })
    const scripted = script()
    if ('reject' in scripted) {
      this.collected = {}
      this.done = Promise.reject(scripted.reject)
    } else {
      this.collected = {
        stdout: new FakeReader(scripted.stdout),
        stderr: new FakeReader(scripted.stderr),
      }
      this.done = Promise.resolve(scripted.outcome)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  waitForExit(_signal?: AbortSignal): Promise<boolean> {
    return Promise.resolve(true)
  }
}

type ScriptResult = ScriptedRun | { reject: Error }

/** A scriptable fake subprocess service recording every spawn spec for assertions. */
class FakeSubprocess extends SubprocessRuntime {
  spawns: SubprocessSpawnSpec[] = []
  override async resolveExecutable(command: string): Promise<string> { return command }
  override spawnTerminal(): Promise<never> { throw new Error('typecheck spawns pipes, never terminals') }
  /** Arms the per-spawn script; a `{ reject }` return scripts a spawn-level failure. */
  handler: (spec: SubprocessSpawnSpec) => ScriptResult = () => runResult('')

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    return new FakeHandle(spec, () => this.handler(spec))
  }
}

/** A stand-in agent whose session header carries the given cwd. */
const agent = (cwd: string) => ({ session: { header: { id: 'session-1', cwd } } })

let callCounter = 0
function call(ctx: Context, args: unknown, options: { agent?: object; signal?: AbortSignal } = {}) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: `typecheck-call-${++callCounter}` as never,
    name: 'typecheck',
    arguments: args,
    ...options.agent ? { agent: options.agent as never } : {},
    ...options.signal ? { signal: options.signal } : {},
  })
}

async function setup(config: ToolTypecheck.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeSubprocess)
  await ctx.plugin(ToolTypecheck, config)
  return { ctx, subprocess: ctx.subprocess as FakeSubprocess }
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

const TS_ERRORS = [
  'src/a.ts(3,5): error TS2322: Type \'string\' is not assignable to type \'number\'.',
  'src/b.ts(1,1): error TS2304: Cannot find name \'x\'.',
  '',
  'Found 2 errors.',
].join('\n')

describe('parseTscOutput', () => {
  it('parses one error line into an LspDiagnostic (severity 1, code, zero-based range)', () => {
    expect(parseTscOutput('src/a.ts(3,5): error TS2322: Type \'x\' is bad.')).toEqual([
      {
        severity: 1,
        code: 'TS2322',
        message: 'Type \'x\' is bad.',
        range: { start: { line: 2, character: 4 }, end: { line: 2, character: 4 } },
      },
    ])
  })

  it('folds indented continuation lines into the open diagnostic message', () => {
    const lines = 'src/a.ts(1,1): error TS2322: Type \'string\' is not assignable to type \'number\'.\n  The expected type comes from property \'x\'.'
    const parsed = parseTscOutput(lines)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.message).toBe('Type \'string\' is not assignable to type \'number\'.\n  The expected type comes from property \'x\'.')
  })

  it('drops the summary and blank separators', () => {
    expect(parseTscOutput(TS_ERRORS)).toHaveLength(2)
    expect(parseTscOutput(TS_ERRORS).map(d => d.code)).toEqual(['TS2322', 'TS2304'])
  })

  it('handles CRLF output and returns empty for clean output', () => {
    expect(parseTscOutput('src/a.ts(1,1): error TS1: oops.\r\n')).toHaveLength(1)
    expect(parseTscOutput('')).toEqual([])
    expect(parseTscOutput('No errors found.\n')).toEqual([])
  })
})

describe('registration', () => {
  it('registers the typecheck tool and its prompt section', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.get('typecheck')).toBeDefined()
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).toContain(TYPECHECK_PROMPT_TEXT)
  })

  it('has no default export (namespace plugin shape)', () => {
    expect((ToolTypecheck as { default?: unknown }).default).toBeUndefined()
  })

  it('rejects a non-positive config value at load', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeSubprocess)
    await expect(ctx.plugin(ToolTypecheck, { maxResultChars: 0 })).rejects.toThrow(/maxResultChars/)
    await expect(ctx.plugin(ToolTypecheck, { maxOutputBytes: -1 })).rejects.toThrow(/maxOutputBytes/)
  })

  it('rejects a timeout above Node timer range at load', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeSubprocess)
    await expect(ctx.plugin(ToolTypecheck, { timeoutMs: MAX_TIMER_DELAY_MS + 1 })).rejects.toThrow(/timeoutMs/)
  })
})

describe('execution', () => {
  it('fails without a session cwd', async () => {
    const { ctx, subprocess } = await setup()
    const result = await call(ctx, {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a session workspace cwd')
    expect(subprocess.spawns).toHaveLength(0)
  })

  it('spawns the fixed tsc argv in the session cwd and renders clean output as empty', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('')
    const result = await call(ctx, {}, { agent: agent('/sessions/s1') })
    expect(result.isError).toBe(false)
    expect(subprocess.spawns[0]?.argv).toEqual(['tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'])
    expect(subprocess.spawns[0]?.cwd).toBe('/sessions/s1')
    expect((subprocess.spawns[0]?.stdio.stdout as { maxBytes: number }).maxBytes).toBe(1_000_000)
    expect((subprocess.spawns[0]?.stdio.stderr as { maxBytes: number }).maxBytes).toBe(64_000)
    expect(result).toMatchObject({ isError: false, value: { kind: 'diagnostics', diagnostics: [] } })
    expect(result.content[0]).toEqual({ type: 'text', text: 'No diagnostics.' })
  })

  it('passes an explicit project through as -p', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('')
    await call(ctx, { project: 'configs/tsconfig.app.json' }, { agent: agent('/w') })
    expect(subprocess.spawns[0]?.argv).toContain('configs/tsconfig.app.json')
  })

  it('returns parsed diagnostics on a failing compile and renders them one-based', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult(TS_ERRORS, { exitCode: 1 })
    const result = await call(ctx, {}, { agent: agent('/w') })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected typecheck success')
    expect(result.value).toEqual({
      kind: 'diagnostics',
      diagnostics: [
        { severity: 1, code: 'TS2322', message: 'Type \'string\' is not assignable to type \'number\'.', range: { start: { line: 2, character: 4 }, end: { line: 2, character: 4 } } },
        { severity: 1, code: 'TS2304', message: 'Cannot find name \'x\'.', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
      ],
      resolvedWorkspaceUri: `file://${pathToFileURL('/w').pathname === '/w' ? '' : '/C:'}/w`,
    })
    expect(text(result)).toBe('3:5 error: Type \'string\' is not assignable to type \'number\'. [TS2322]\n1:1 error: Cannot find name \'x\'. [TS2304]')
  })

  it('caps the rendered text at maxResultChars', async () => {
    const { ctx, subprocess } = await setup({ maxResultChars: 60 })
    subprocess.handler = () => runResult(TS_ERRORS, { exitCode: 1 })
    const result = await call(ctx, {}, { agent: agent('/w') })
    expect(text(result)).toHaveLength(60)
    expect(text(result)).toContain('diagnostics truncated')
  })

  it('fails a nonzero exit with no parsed diagnostics, carrying the stderr excerpt', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => runResult('', { exitCode: 2, stderr: { text: 'error TS5023: Unknown compiler option \'--watcel\'.' } })
    const result = await call(ctx, {}, { agent: agent('/w') })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('tsc exited with 2')
    expect(text(result)).toContain('TS5023')
  })

  it('classifies a spawn rejection as a tool failure', async () => {
    const { ctx, subprocess } = await setup()
    subprocess.handler = () => ({ reject: new Error('spawn ENOENT') })
    const result = await call(ctx, {}, { agent: agent('/w') })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('spawn ENOENT')
  })

  it('forwards exec.signal into the spawn spec and reports an abort as a failure', async () => {
    const { ctx, subprocess } = await setup()
    const controller = new AbortController()
    subprocess.handler = () => {
      controller.abort('timeout')
      return runResult('', { exitCode: null, signal: 'SIGTERM' })
    }
    const result = await call(ctx, {}, { agent: agent('/w'), signal: controller.signal })
    expect(subprocess.spawns[0]?.signal).toBe(controller.signal)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('typecheck aborted')
  })

  it('presentCall renders an execute-card view', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.get('typecheck')?.presentCall?.({})).toEqual({
      card: 'generic',
      kind: 'execute',
      title: 'Typecheck (tsc --noEmit)',
    })
  })
})
