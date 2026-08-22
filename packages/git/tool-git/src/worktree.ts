/**
 * `git_worktree` — create, list, and remove worktrees. Creation is confined to
 * this repository's shadow root (`<gitDir>/dsh-shadow/<name>`): a model-supplied
 * path that escapes that root — absolute, parent-traversal, glob metacharacters,
 * or landing on the root itself — is rejected before any git invocation. Removal
 * refuses any path outside the shadow root, so the main working tree can never
 * be a removal target.
 * @module @deepseek-ai/dsh-tool-git/worktree
 */

import type { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, TerminalCallView, TerminalResultView } from '@deepseek-ai/dsh-tools'
import { assertInsideShadowRoot, formatResult, isShadowBranch, runGit } from './git.ts'
import { resolveCwd, resolveShadowRoot, terminalResult } from './helpers.ts'
import type { GitToolCaps } from './helpers.ts'

/** One entry of a normalized `git worktree list --porcelain` listing. */
export interface WorktreeEntry {
  path: string
  headSha?: string
  headShort?: string
  branch?: string
  detached: boolean
}

/** Result of one `git_worktree` operation. */
export interface WorktreeResult {
  operation: 'add' | 'list' | 'remove'
  worktreePath?: string
  branch?: string
  worktrees?: WorktreeEntry[]
  output?: string
}

/** Normalize a path for separator-agnostic comparison with porcelain output. */
function normalized(path: string): string {
  return path.replaceAll(/[\\/]/g, '/')
}

/** Parse `git worktree list --porcelain` output into normalized entries. */
export function parseWorktreeList(raw: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: WorktreeEntry | undefined
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current !== undefined) entries.push(current)
      current = { path: line.slice('worktree '.length), detached: false }
      continue
    }
    if (current === undefined) continue
    if (line.startsWith('HEAD ')) {
      const sha = line.slice('HEAD '.length).trim()
      current.headSha = sha
      current.headShort = sha.slice(0, 7)
      continue
    }
    if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    }
  }
  if (current !== undefined) entries.push(current)
  return entries
}

/** Render one normalized worktree entry on one line. */
function renderEntry(entry: WorktreeEntry): string {
  const head = entry.headShort ?? '(no commit)'
  const branch = entry.detached ? 'detached' : entry.branch ?? '(no branch)'
  return `${entry.path}  ${head}  ${branch}`
}

/** The rendered text of a `WorktreeResult` (the model-visible output). */
export function renderWorktreeResult(value: { operation: string; worktrees?: WorktreeEntry[]; output?: string }): string {
  if (value.operation === 'list') {
    return value.worktrees !== undefined && value.worktrees.length > 0
      ? value.worktrees.map(renderEntry).join('\n')
      : '(no worktrees)'
  }
  return value.output ?? '(no output)'
}

/** Sanitize a model-supplied shadow worktree name into one safe path element. */
export function sanitizeShadowName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned : 'session'
}

/** Register the `git_worktree` tool. */
export function registerWorktreeTool(ctx: Context, caps: GitToolCaps): void {
  ctx.tools.register(defineTool({
    name: 'git_worktree',
    description: 'Manage shadow worktrees inside this repository: add, list, or remove. '
      + 'Add creates a worktree at <git dir>/dsh-shadow/<name> with a temporary dsh-shadow/<name> branch, '
      + 'so the main working tree is never touched. Remove refuses any worktree outside the shadow root. '
      + 'Prefer git_shadow_run for one-off validation commands that create and roll back a shadow worktree automatically.',
    parameters: {
      operation: { type: 'string', enum: ['add', 'list', 'remove'], required: true, description: 'The worktree operation to perform.' },
      path: { type: 'string', description: 'For add: the shadow worktree name (a single directory name, stored under <git dir>/dsh-shadow/); for remove: the shadow worktree path shown by list.' },
      branch: { type: 'string', description: 'For add: the branch name to create at the worktree (namespaced as dsh-shadow/<name>).' },
      base: { type: 'string', description: 'For add: commit, branch, or tag to base the new worktree on (defaults to HEAD).' },
      workdir: { type: 'string', description: 'Directory to run git in. Defaults to the session workspace.' },
    },
    timeoutMs: caps.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          operation: { type: 'string', required: true },
          worktreePath: { type: 'string' },
          branch: { type: 'string' },
          worktrees: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                headSha: { type: 'string' },
                headShort: { type: 'string' },
                branch: { type: 'string' },
                detached: { type: 'boolean', required: true },
              },
            },
          },
          output: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWorktreeResult(value) }],
    },
    async execute(args, exec) {
      const cwd = resolveCwd(args.workdir, exec.agent)
      const shadowRoot = await resolveShadowRoot(ctx, cwd, exec.signal)
      switch (args.operation) {
        case 'list': {
          const r = await runGit(ctx, ['worktree', 'list', '--porcelain'], cwd, exec.signal)
          if (r.exitCode !== 0) throw new Error(formatResult(r))
          return { operation: 'list', worktrees: parseWorktreeList(r.stdout) }
        }
        case 'add': {
          const name = args.path ?? 'session'
          if (name.split(/[\\/]/).some(segment => segment === '..')) {
            throw new Error(`git_worktree: path must not traverse parent directories — refusing ${JSON.stringify(name)}`)
          }
          const branch = args.branch !== undefined && args.branch.length > 0
            ? args.branch
            : `dsh-shadow/${sanitizeShadowName(name)}`
          const worktreePath = name.includes('/') || name.includes('\\')
            // A path-typed add must already be an absolute path inside the shadow root.
            ? assertInsideShadowRoot(shadowRoot, resolve(name))
            : assertInsideShadowRoot(shadowRoot, resolve(shadowRoot, sanitizeShadowName(name)))
          const base = args.base ?? 'HEAD'
          const argv = ['worktree', 'add', worktreePath, '-b', branch]
          if (base !== 'HEAD' && base !== '') argv.push(base)
          const r = await runGit(ctx, argv, cwd, exec.signal)
          if (r.exitCode !== 0) throw new Error(formatResult(r))
          return { operation: 'add', worktreePath, branch, output: formatResult(r) }
        }
        case 'remove': {
          if (args.path === undefined) throw new Error('git_worktree: path is required for remove')
          const removePath = resolve(cwd, args.path)
          assertInsideShadowRoot(shadowRoot, removePath)
          const listed = await runGit(ctx, ['worktree', 'list', '--porcelain'], cwd, exec.signal)
          const before = listed.exitCode === 0 ? parseWorktreeList(listed.stdout) : []
          const entry = before.find(e => normalized(e.path) === normalized(removePath))
          const r = await runGit(ctx, ['worktree', 'remove', '--force', removePath], cwd, exec.signal)
          if (r.exitCode !== 0) throw new Error(formatResult(r))
          let removedBranch: string | undefined
          if (entry?.branch !== undefined && isShadowBranch(entry.branch)) {
            const del = await runGit(ctx, ['branch', '--delete', '--force', entry.branch], cwd, exec.signal)
            if (del.exitCode === 0) removedBranch = entry.branch
          }
          const removed: WorktreeResult = { operation: 'remove', worktreePath: removePath, output: formatResult(r) }
          if (removedBranch !== undefined) removed.branch = removedBranch
          return removed
        }
      }
    },
    presentCall(args): GenericCallView | TerminalCallView {
      if (args.operation === 'list') {
        return { card: 'generic', title: 'git worktree list', kind: 'execute' }
      }
      return { card: 'terminal', title: `git worktree ${args.operation} ${args.path ?? args.branch ?? ''}`.trim() }
    },
    presentResult(_args, result): TerminalResultView | undefined {
      return terminalResult('git worktree', result)
    },
  }))
}
