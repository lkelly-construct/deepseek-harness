/**
 * Model-facing git tools for the DeepSeek Harness: status, diff, log, commit,
 * branch, plus shadow-worktree tooling (`git_worktree`, `git_shadow_run`).
 * Every executable git invocation goes through `ctx.subprocess.spawn` with
 * bounded collected output — never a raw child-process fork; shadow worktrees
 * are confined to the repository's `dsh-shadow` root and rolled back on exit.
 * @module @deepseek-ai/dsh-tool-git
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffCallView, DiffResultView, FileDiff, GenericCallView, TerminalCallView, TerminalResultView } from '@deepseek-ai/dsh-tools'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { formatResult, runGit } from './git.ts'
import { resolveCwd, terminalResult } from './helpers.ts'
import type { GitToolCaps } from './helpers.ts'
import { registerShadowRunTool } from './shadow-run.ts'
import { registerWorktreeTool } from './worktree.ts'

export const name = 'tool-git'
export const inject = ['tools', 'subprocess', 'systemPrompt']

/** Default cooperative timeout budget (ms) for the shadow-run validation command. */
const DEFAULT_SHADOW_TIMEOUT_MS = 30_000
/** Default per-stream collected-output cap (bytes) for a shadow-run command's tail. */
const DEFAULT_SHADOW_OUTPUT_BYTES = 64 * 1024
/** Default terminate-escalation grace (ms) for every spawned process. */
const DEFAULT_GRACE_MS = 3_000

/** Plugin config for the git tool suite. */
export interface Config {
  /** Cooperative tool-call timeout budget (ms) for `git_shadow_run` (and `git_worktree`). */
  timeoutMs?: number
  /** Max stdout bytes retained (tail) for one shadow-run validation command. */
  maxStdoutBytes?: number
  /** Max stderr bytes retained (tail) for one shadow-run validation command. */
  maxStderrBytes?: number
  /** Terminate-escalation grace (ms) handed to every spawned process. */
  graceMs?: number
}

/** Runtime configuration schema for the git tool suite. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(DEFAULT_SHADOW_TIMEOUT_MS),
  maxStdoutBytes: z.number().default(DEFAULT_SHADOW_OUTPUT_BYTES),
  maxStderrBytes: z.number().default(DEFAULT_SHADOW_OUTPUT_BYTES),
  graceMs: z.number().default(DEFAULT_GRACE_MS),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-git: ${name} must be a positive integer`)
  }
}

// ── diff parsing ───────────────────────────────────────────────────────────

function parseDiffOutput(raw: string): FileDiff[] {
  if (!raw.trim()) return []
  const sections = raw.split(/^(?=diff --git )/m).filter(s => s.trim())
  const diffs: FileDiff[] = []
  for (const section of sections) {
    const headerMatch = section.match(/^diff --git a\/.+ b\/(.+)/)
    const path = (headerMatch?.[1] ?? '(unknown)').trimEnd()
    const isNew = /^new file mode/m.test(section)
    const isDeleted = /^deleted file mode/m.test(section)
    const hunks = section
      .replace(/^(diff --git|index|new file|deleted file|old mode|new mode|similarity|rename|Binary files)[^\n]*\n?/gm, '')
      .replace(/^---[^\n]*\n?/m, '')
      .replace(/^\+\+\+[^\n]*\n?/m, '')
      .trim()
    diffs.push({ path, oldText: isNew ? null : hunks, newText: isDeleted ? '' : hunks })
  }
  return diffs
}

// ── plugin ─────────────────────────────────────────────────────────────────

export function apply(ctx: Context, config: Config): void {
  // schemastery has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveInteger('timeoutMs', resolved.timeoutMs)
  assertPositiveInteger('maxStdoutBytes', resolved.maxStdoutBytes)
  assertPositiveInteger('maxStderrBytes', resolved.maxStderrBytes)
  assertPositiveInteger('graceMs', resolved.graceMs)
  if (resolved.timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-git: timeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (resolved.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-git: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const caps: GitToolCaps = {
    timeoutMs: resolved.timeoutMs,
    maxStdoutBytes: resolved.maxStdoutBytes,
    maxStderrBytes: resolved.maxStderrBytes,
    graceMs: resolved.graceMs,
  }

  ctx.systemPrompt.section({
    name: 'tool:git',
    order: 150,
    text: `## Git workflow

Use the git_* tools for all version-control operations.

- Always run git_status and git_diff before committing — confirm exactly what is staged.
- Never commit or push unless the user explicitly asks.
- Write commit messages in the imperative mood ("Fix X", "Add Y").
- Never use git push --force unless the user explicitly instructs it.
- Never amend a commit that has already been pushed.
- Prefer small, focused commits over large batches.

## Shadow worktrees

- git_shadow_run creates an isolated checkout under <git dir>/dsh-shadow and runs one validation command inside it (typecheck, build, tests), then automatically removes the worktree and its temporary branch. It never touches the main working tree.
- Use git_shadow_run for commands that mutate a checkout (formatters, generators, test fixtures) or where idle files would dirty your status.
- When the user asks you to plan, validate, or make broad or risky changes — refactors, renames, big edits — run the change's checks (typecheck, tests, build) inside a git_shadow_run worktree and report the outcome before touching the main working tree. Do not wait for the user to name git_shadow_run; it is how you sandbox a proposed change.
- git_worktree manages shadow worktrees explicitly; every shadow path stays inside the confined dsh-shadow root. Never pass a path outside that root.`,
  })

  // ── git_status ────────────────────────────────────────────────────────

  ctx.tools.register(defineTool({
    name: 'git_status',
    description: 'Show the working tree status: staged changes, unstaged changes, and untracked files. '
      + 'Run this before any git_commit call to confirm what will be included.',
    parameters: {
      workdir: { type: 'string', description: 'Directory to run git in. Defaults to the session workspace.' },
    },
    timeoutMs: 15_000,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const cwd = resolveCwd(args.workdir, exec.agent)
      const r = await runGit(ctx, ['status'], cwd, exec.signal)
      return formatResult(r)
    },
    presentCall(args): TerminalCallView {
      return { card: 'terminal', title: 'git status', ...args.workdir !== undefined ? { cwd: args.workdir } : {} }
    },
    presentResult(_args, result): TerminalResultView | undefined {
      return terminalResult('git status', result)
    },
  }))

  // ── git_diff ──────────────────────────────────────────────────────────

  ctx.tools.register(defineTool({
    name: 'git_diff',
    description: 'Show changes as a unified diff. Without arguments shows unstaged working-tree changes. '
      + 'Set staged: true for staged-but-uncommitted changes. Pass a ref to compare against that commit, branch, or tag. '
      + 'Optionally scope to one file or directory.',
    parameters: {
      ref: { type: 'string', description: 'Commit, branch, or tag to diff against (e.g. "HEAD", "main", "abc1234"). Omit for working-tree vs index.' },
      staged: { type: 'boolean', description: 'Show staged changes (index vs HEAD) instead of working-tree changes.' },
      path: { type: 'string', description: 'Limit the diff to this file or directory.' },
      workdir: { type: 'string', description: 'Directory to run git in. Defaults to the session workspace.' },
    },
    timeoutMs: 30_000,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value || '(no changes)' }],
    },
    async execute(args, exec) {
      const cwd = resolveCwd(args.workdir, exec.agent)
      const argv: string[] = ['diff', '--unified=3']
      if (args.staged) argv.push('--cached')
      if (args.ref) argv.push(args.ref)
      if (args.path) { argv.push('--'); argv.push(args.path) }
      const r = await runGit(ctx, argv, cwd, exec.signal)
      return r.exitCode === 0 ? r.stdout : formatResult(r)
    },
    presentCall(args): DiffCallView {
      const target = args.staged ? 'staged' : (args.ref ?? 'working tree')
      const title = args.path ? `git diff ${target} — ${args.path}` : `git diff ${target}`
      return { card: 'diff', title, diffs: [] }
    },
    presentResult(args, result): DiffResultView | undefined {
      if (result.isError) return undefined
      const text = result.content.find(b => b.type === 'text')?.text ?? ''
      const diffs = parseDiffOutput(text)
      const target = args.staged ? 'staged' : (args.ref ?? 'working tree')
      const title = args.path ? `git diff ${target} — ${args.path}` : `git diff ${target}`
      return { card: 'diff', title, diffs }
    },
  }))

  // ── git_log ───────────────────────────────────────────────────────────

  ctx.tools.register(defineTool({
    name: 'git_log',
    description: 'Show recent commit history: hash, author, date, and subject per commit.',
    parameters: {
      n: { type: 'integer', description: 'Number of commits to show (default 20).' },
      branch: { type: 'string', description: 'Branch or ref to show history for (default: current branch).' },
      path: { type: 'string', description: 'Limit to commits touching this file or directory.' },
      workdir: { type: 'string', description: 'Directory to run git in. Defaults to the session workspace.' },
    },
    timeoutMs: 15_000,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const cwd = resolveCwd(args.workdir, exec.agent)
      const argv: string[] = ['log', `--max-count=${args.n ?? 20}`, '--format=%H %an %as %s']
      if (args.branch) argv.push(args.branch)
      if (args.path) { argv.push('--'); argv.push(args.path) }
      const r = await runGit(ctx, argv, cwd, exec.signal)
      return formatResult(r)
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `git log ${args.branch ?? 'HEAD'}`, kind: 'execute' }
    },
    presentResult(_args, result): TerminalResultView | undefined {
      return terminalResult('git log', result)
    },
  }))

  // ── git_commit ────────────────────────────────────────────────────────

  ctx.tools.register(defineTool({
    name: 'git_commit',
    description: 'Create a commit with the given message. Only commits already-staged changes unless all: true. '
      + 'Run git_status first. Only call this when the user explicitly asks you to commit.',
    parameters: {
      message: { type: 'string', required: true, description: 'Commit message in the imperative mood: "Fix X", "Add Y".' },
      all: { type: 'boolean', description: 'Stage all tracked modified/deleted files before committing (git commit -a). Does not add untracked files.' },
      workdir: { type: 'string', description: 'Directory to run git in. Defaults to the session workspace.' },
    },
    timeoutMs: 30_000,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (!args.message.trim()) throw new Error('message must be a non-empty string')
      const cwd = resolveCwd(args.workdir, exec.agent)
      const argv: string[] = ['commit', `--message=${args.message}`]
      if (args.all) argv.push('--all')
      const r = await runGit(ctx, argv, cwd, exec.signal)
      return formatResult(r)
    },
    presentCall(args): TerminalCallView {
      const flag = args.all ? ' -a' : ''
      return { card: 'terminal', title: `git commit${flag} -m "${args.message}"`, ...args.workdir !== undefined ? { cwd: args.workdir } : {} }
    },
    presentResult(_args, result): TerminalResultView | undefined {
      return terminalResult('git commit', result)
    },
  }))

  // ── git_branch ────────────────────────────────────────────────────────

  ctx.tools.register(defineTool({
    name: 'git_branch',
    description: 'List, create, or delete branches. Without arguments, lists all local branches with their tracking status. '
      + 'Pass name to create a new branch at HEAD. Pass delete: true with name to delete a branch.',
    parameters: {
      name: { type: 'string', description: 'Branch name to create or delete. Omit to list branches.' },
      delete: { type: 'boolean', description: 'Delete the named branch (must also pass name).' },
      workdir: { type: 'string', description: 'Directory to run git in. Defaults to the session workspace.' },
    },
    timeoutMs: 15_000,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const cwd = resolveCwd(args.workdir, exec.agent)
      let argv: string[]
      if (args.delete) {
        if (!args.name) throw new Error('name is required when delete is true')
        argv = ['branch', '--delete', args.name]
      } else if (args.name) {
        argv = ['branch', args.name]
      } else {
        argv = ['branch', '--list', '--verbose']
      }
      const r = await runGit(ctx, argv, cwd, exec.signal)
      return formatResult(r)
    },
    presentCall(args): GenericCallView {
      const op = args.delete ? `delete ${args.name}` : (args.name ? `create ${args.name}` : 'list')
      return { card: 'generic', title: `git branch — ${op}`, kind: 'execute' }
    },
    presentResult(_args, result): TerminalResultView | undefined {
      return terminalResult('git branch', result)
    },
  }))

  // ── git_worktree / git_shadow_run ─────────────────────────────────────

  registerWorktreeTool(ctx, caps)
  registerShadowRunTool(ctx, caps)
}
