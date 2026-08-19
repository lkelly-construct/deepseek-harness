import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffCallView, DiffResultView, FileDiff, GenericCallView, TerminalCallView, TerminalResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

export const name = 'tool-git'
export const inject = ['tools', 'subprocess', 'systemPrompt']

// ── subprocess helper ──────────────────────────────────────────────────────

interface GitResult {
  stdout: string
  stderr: string
  exitCode: number
}

async function runGit(ctx: Context, argv: string[], cwd: string, signal: AbortSignal): Promise<GitResult> {
  const handle: SubprocessHandle = ctx.subprocess.spawn({
    argv: ['git', ...argv],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 4_000_000 },
      stderr: { maxBytes: 64 * 1024 },
    },
    graceMs: 3_000,
    signal,
  } satisfies SubprocessSpawnSpec)
  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  return {
    stdout: stdout?.text ?? '',
    stderr: stderr?.text ?? '',
    exitCode: outcome.exitCode ?? 0,
  }
}

function formatResult(r: GitResult): string {
  const out = r.stdout.trim()
  const err = r.stderr.trim()
  const body = [out, err].filter(Boolean).join('\n')
  if (r.exitCode === 0) return body || '(no output)'
  return `${body}\n[exit code: ${r.exitCode}]`.trim()
}

function resolveCwd(workdir: string | undefined, agent: Agent | undefined): string {
  return workdir ?? agent?.session.header.cwd ?? process.cwd()
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

// ── presentation helpers ───────────────────────────────────────────────────

function terminalResult(title: string, result: ToolResult): TerminalResultView | undefined {
  if (result.isError) return undefined
  const text = result.content.find(b => b.type === 'text')?.text ?? ''
  return { card: 'terminal', title, output: text }
}

// ── plugin ─────────────────────────────────────────────────────────────────

export function apply(ctx: Context): void {

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
- Prefer small, focused commits over large batches.`,
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
      if (!args.message?.trim()) throw new Error('message must be a non-empty string')
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
}
