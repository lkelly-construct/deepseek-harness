/**
 * Keyless integration tests for the shadow-worktree git tools
 * (`git_worktree`, `git_shadow_run`): real `git` binaries over the real local
 * subprocess service, exercised through `ctx.tools.execute()`. No network, no
 * mocks — each suite boots a fresh `git init` repository in a temp dir.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolGit from '@deepseek-ai/dsh-tool-git'

const testToolSignal = new AbortController().signal

/** A system-config-silencing null device that works on every platform. */
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null'

/** Run one git command synchronously against a test repo (fixture setup only). */
function git(repo: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: NULL_DEVICE,
      GIT_CONFIG_SYSTEM: NULL_DEVICE,
    },
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.status}): ${result.stderr?.trim()}`)
  }
}

/** The shadow root a tool run derives for the fixture repo. */
function shadowRootOf(repo: string): string {
  return resolve(repo, '.git', 'dsh-shadow')
}

/** The local branches of the fixture repo. */
function branches(repo: string): string[] {
  const result = spawnSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: NULL_DEVICE, GIT_CONFIG_SYSTEM: NULL_DEVICE },
  })
  return (result.stdout ?? '').split('\n').map(line => line.trim()).filter(Boolean)
}

/** The branches of the fixture repo that live under the shadow namespace. */
function shadowBranches(repo: string): string[] {
  return branches(repo).filter(name => /(^|\/)dsh-shadow\//.test(name))
}

/** The porcelain shadow worktree paths of the fixture repo. */
function shadowWorktreePaths(repo: string): string[] {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: NULL_DEVICE, GIT_CONFIG_SYSTEM: NULL_DEVICE },
  })
  const paths: string[] = []
  for (const line of (result.stdout ?? '').split('\n')) {
    if (line.startsWith('worktree ') && line.includes('dsh-shadow')) {
      paths.push(line.slice('worktree '.length))
    }
  }
  return paths
}

/** Boot the plugin stack with the tool-git plugin mounted. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ToolGit)
  return ctx
}

/** Execute one tool call with an incrementing call id, rooted at the fixture repo. */
function caller(ctx: Context, repo: string) {
  let seq = 0
  return (name: string, args: Record<string, unknown>) => ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`it-${++seq}`),
    name,
    arguments: { workdir: repo, ...args },
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('git_worktree', () => {
  let ctx: Context | undefined
  let repo: string

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'dsh-git-wt-'))
    await writeFile(join(repo, 'tracked.txt'), 'hello\n')
    git(repo, ['init', '-q'])
    git(repo, ['config', 'user.email', 't@example.com'])
    git(repo, ['config', 'user.name', 'Test'])
    git(repo, ['add', '.'])
    git(repo, ['commit', '-qm', 'init'])
    await writeFile(join(repo, 'tracked.txt'), 'modified-in-main\n')
    ctx = await setup()
  })

  afterEach(async () => {
    await ctx?.fiber.dispose()
    await rm(repo, { recursive: true, force: true })
  })

  const call = () => caller(ctx as Context, repo)

  it('add creates a shadow worktree plus branch; list shows it; remove cleans both', async () => {
    const add = await call()('git_worktree', { operation: 'add', path: 'probe' })
    expect(add.isError).toBe(false)
    expect(text(add)).toContain('probe')
    expect(branches(repo)).toContain('dsh-shadow/probe')
    expect(shadowWorktreePaths(repo).length).toBe(1)

    const list = await call()('git_worktree', { operation: 'list' })
    expect(list.isError).toBe(false)
    expect(text(list)).toContain('probe')

    // The main working tree is not a removal target.
    const refusal = await call()('git_worktree', { operation: 'remove', path: repo })
    expect(refusal.isError).toBe(true)
    expect(text(refusal)).toMatch(/refusing a non-shadow worktree/i)

    const remove = await call()('git_worktree', { operation: 'remove', path: shadowRootOf(repo) + '/probe' })
    expect(remove.isError).toBe(false)
    expect(branches(repo)).not.toContain('dsh-shadow/probe')
    expect(shadowWorktreePaths(repo)).toEqual([])
  })

  it('rejects an absolute path outside the confined shadow root', async () => {
    const escape = join(repo, 'escape')
    const result = await call()('git_worktree', { operation: 'add', path: `${escape}/wk` })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/refusing a non-shadow worktree/i)
    expect(existsSync(escape)).toBe(false)
  })

  it('rejects parent traversal in the worktree path', async () => {
    const result = await call()('git_worktree', { operation: 'add', path: 'a/../../escape' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/must not traverse parent directories/i)
    expect(existsSync(join(repo, 'escape'))).toBe(false)
  })
})

describe('git_shadow_run', () => {
  let ctx: Context | undefined
  let repo: string

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'dsh-git-shadow-'))
    await writeFile(join(repo, 'tracked.txt'), 'hello\n')
    git(repo, ['init', '-q'])
    git(repo, ['config', 'user.email', 't@example.com'])
    git(repo, ['config', 'user.name', 'Test'])
    git(repo, ['add', '.'])
    git(repo, ['commit', '-qm', 'init'])
    // Dirty the main working tree: shadow runs must never touch it.
    await writeFile(join(repo, 'dirty.txt'), 'main working tree\n')
    ctx = await setup()
  })

  afterEach(async () => {
    await ctx?.fiber.dispose()
    await rm(repo, { recursive: true, force: true })
  })

  const call = () => caller(ctx as Context, repo)

  it('runs the command in the shadow copy and touches neither the main tree nor git state', async () => {
    const result = await call()('git_shadow_run', {
      command: [process.execPath, '-e', "require('node:fs').writeFileSync('written.txt', 'shadow')"],
    })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ rolledBack: true, exitCode: 0 })
    expect(existsSync(join(repo, 'written.txt'))).toBe(false)
    expect(existsSync(join(repo, 'dirty.txt'))).toBe(true)
    expect(shadowWorktreePaths(repo)).toEqual([])
    expect(shadowBranches(repo)).toEqual([])

    // The shadow copy saw the committed tree (HEAD), not the dirty file.
    const dirtyCheck = await call()('git_shadow_run', {
      command: [process.execPath, '-e', "process.stdout.write(require('node:fs').existsSync('dirty.txt') ? 'dirty-present' : 'dirty-absent')"],
    })
    expect(text(dirtyCheck)).toContain('dirty-absent')
  })

  it('failing command returns non-zero marker and rolls back (no worktree, no branch left)', async () => {
    const result = await call()('git_shadow_run', {
      command: [process.execPath, '-e', 'process.exit(7)'],
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('[exit code: 7]')
    expect(shadowWorktreePaths(repo)).toEqual([])
    expect(shadowBranches(repo)).toEqual([])
    expect(existsSync(join(repo, 'dirty.txt'))).toBe(true)
  })

  it('rejects an empty command before creating anything', async () => {
    const result = await call()('git_shadow_run', { command: [] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('must be a non-empty array')
    expect(shadowWorktreePaths(repo)).toEqual([])
  })

  it('keepWorktree: true leaves the shadow worktree and branch in place', async () => {
    const result = await call()('git_shadow_run', {
      command: [process.execPath, '-e', 'process.exit(0)'],
      keepWorktree: true,
    })
    expect(result.isError).toBe(false)
    const kept = shadowWorktreePaths(repo)
    expect(kept.length).toBe(1)
    expect(shadowBranches(repo).length).toBe(1)
  })

  it('base pins the worktree to a specific commit', async () => {
    await writeFile(join(repo, 'second.txt'), 'second\n')
    git(repo, ['add', '.'])
    git(repo, ['commit', '-qm', 'second'])

    const atHead = await call()('git_shadow_run', {
      command: [process.execPath, '-e', "process.stdout.write(require('node:fs').existsSync('second.txt') ? 'has-second' : 'no-second')"],
    })
    expect(text(atHead)).toContain('has-second')

    const atBase = await call()('git_shadow_run', {
      base: 'HEAD~1',
      command: [process.execPath, '-e', "process.stdout.write(require('node:fs').existsSync('second.txt') ? 'has-second' : 'no-second')"],
    })
    expect(text(atBase)).toContain('no-second')
  })
})
