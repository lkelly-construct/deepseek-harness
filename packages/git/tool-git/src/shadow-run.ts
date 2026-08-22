/**
 * `git_shadow_run` — create a shadow worktree in the confined shadow root,
 * run a validation command inside it, and roll it back (remove the worktree
 * and delete its temporary `dsh-shadow/<id>` branch) unless the caller asked
 * to keep it. Rollback runs unconditionally — on a failing validation
 * command, a thrown spawn error, and an aborted tool call — so no dangling
 * worktree or branch survives a call.
 * @module @deepseek-ai/dsh-tool-git/shadow-run
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TerminalCallView, TerminalResultView } from '@deepseek-ai/dsh-tools'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { assertInsideShadowRoot, formatResult, isShadowBranch, runGit } from './git.ts'
import { resolveCwd, resolveShadowRoot, terminalResult, trimTailUtf8 } from './helpers.ts'
import type { GitToolCaps } from './helpers.ts'

/** Validate the model-supplied command argv vector. */
function validateCommand(command: unknown): string[] {
  if (!Array.isArray(command) || command.length === 0 || command.some(part => typeof part !== 'string' || part.length === 0)) {
    throw new Error('git_shadow_run: command must be a non-empty array of non-empty argv strings')
  }
  return command as string[]
}

/** The verdict of one shadow rollback. */
export type RollbackVerdict =
  | { kind: 'kept' }
  | { kind: 'rolled-back' }
  | { kind: 'failed'; message: string }

/**
 * Roll the shadow worktree back: remove it (`--force`), then delete its
 * temporary branch (a `dsh-shadow/<id>` branch, so the deletion target is
 * always a shadow branch). Uses its own abort controller so the caller's
 * tool timeout or abort never cuts the rollback short. With `keepWorktree`
 * the shadow state is intentionally left in place.
 * @param ctx - plugin context carrying the subprocess service.
 * @param repoCwd - repository working directory for the git calls.
 * @param worktreePath - the shadow worktree path being rolled back.
 * @param branch - the shadow branch to delete (only when `keepWorktree` is false).
 * @param keepWorktree - when true, keep the worktree and branch in place.
 * @param caps - resolved caps (the rollback runs under its own fresh budget).
 * @returns the rollback verdict; `failed` carries cleanup error text.
 */
export async function rollbackShadow(
  ctx: Context,
  repoCwd: string,
  worktreePath: string,
  branch: string,
  keepWorktree: boolean,
  caps: GitToolCaps,
): Promise<RollbackVerdict> {
  void caps
  const rollbackSignal = new AbortController().signal
  if (keepWorktree) return { kind: 'kept' }
  const problems: string[] = []
  const removed = await runGit(ctx, ['worktree', 'remove', '--force', worktreePath], repoCwd, rollbackSignal)
  const worktreeGone = removed.exitCode === 0 || !existsSync(worktreePath)
  if (!worktreeGone) problems.push(`worktree remove failed: ${formatResult(removed)}`)
  if (isShadowBranch(branch)) {
    const deleted = await runGit(ctx, ['branch', '--delete', '--force', branch], repoCwd, rollbackSignal)
    const branchGone = deleted.exitCode === 0 || /not found|no such branch/i.test(deleted.stderr)
    if (!branchGone) problems.push(`branch -D failed: ${formatResult(deleted)}`)
  }
  return problems.length > 0 ? { kind: 'failed', message: problems.join('; ') } : { kind: 'rolled-back' }
}

/** Captured validation-command facts; `spawnError` marks a spawn-level failure. */
interface ShadowOutcome {
  exitCode: number
  outputTail: string
  spawnError?: string
}

/** Run one arbitrary validation command inside the worktree and capture bounded output. */
async function runCommand(
  ctx: Context,
  argv: string[],
  cwd: string,
  signal: AbortSignal,
  caps: GitToolCaps,
): Promise<ShadowOutcome> {
  const handle: SubprocessHandle = ctx.subprocess.spawn({
    argv,
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: caps.maxStdoutBytes },
      stderr: { maxBytes: caps.maxStderrBytes },
    },
    graceMs: caps.graceMs,
    signal,
  } satisfies SubprocessSpawnSpec)
  const outcome = await handle.done
  const stdoutRead = handle.collected.stdout?.readFrom(0)
  const stderrRead = handle.collected.stderr?.readFrom(0)
  return {
    exitCode: outcome.exitCode ?? -1,
    outputTail: trimTailUtf8([stdoutRead?.text ?? '', stderrRead?.text ?? ''].filter(Boolean).join('\n'), caps.maxStdoutBytes + caps.maxStderrBytes),
  }
}

/** Combine the captured tail (or spawn error) with the `[exit code: N]` convention. */
function renderShadowTail(outcome: ShadowOutcome): string {
  const body = outcome.spawnError !== undefined
    ? `spawn failed: ${outcome.spawnError}`
    : outcome.outputTail
  return outcome.exitCode !== 0 ? `${body}\n[exit code: ${outcome.exitCode}]`.trim() : body
}

/** Register the `git_shadow_run` tool. */
export function registerShadowRunTool(ctx: Context, caps: GitToolCaps): void {
  ctx.tools.register(defineTool({
    name: 'git_shadow_run',
    description: 'Create a shadow worktree of this repository in a confined root, run one validation '
      + 'command inside it, and roll the worktree and its temporary dsh-shadow/<id> branch back automatically '
      + 'unless keepWorktree is true. The main working tree and its branches are never touched. '
      + 'Use for commands that must operate on a clean checkout: typecheck, build, tests, formatters.',
    parameters: {
      base: { type: 'string', description: 'Commit, branch, or tag to base the shadow worktree on (defaults to current HEAD).' },
      command: { type: 'array', items: { type: 'string' }, required: true, description: 'argv strings to run inside the worktree, e.g. ["pnpm", "exec", "tsc", "-b"].' },
      keepWorktree: { type: 'boolean', description: 'Keep the shadow worktree and branch after the run instead of rolling them back (default false).' },
      workdir: { type: 'string', description: 'Directory to run git in. Defaults to the session workspace.' },
    },
    timeoutMs: caps.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exitCode: { type: 'integer', required: true },
          worktreePath: { type: 'string', required: true },
          outputTail: { type: 'string', required: true },
          branch: { type: 'string', required: true },
          rolledBack: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.outputTail }],
    },
    async execute(args, exec) {
      const command = validateCommand(args.command)
      const cwd = resolveCwd(args.workdir, exec.agent)
      const shadowRoot = await resolveShadowRoot(ctx, cwd, exec.signal)
      const id = randomUUID()
      const worktreePath = resolve(shadowRoot, id)
      const branch = `dsh-shadow/${id}`
      assertInsideShadowRoot(shadowRoot, worktreePath)

      const addArgv = ['worktree', 'add', worktreePath, '-b', branch]
      if (args.base !== undefined && args.base !== 'HEAD' && args.base !== '') addArgv.push(args.base)
      const added = await runGit(ctx, addArgv, cwd, exec.signal)
      if (added.exitCode !== 0) {
        // Best-effort cleanup: a partial add may still have left a worktree or branch behind.
        await rollbackShadow(ctx, cwd, worktreePath, branch, false, caps)
        throw new Error(`git_shadow_run: failed to create shadow worktree: ${formatResult(added)}`)
      }

      let outcome: ShadowOutcome
      try {
        outcome = await runCommand(ctx, command, worktreePath, exec.signal, caps)
      } catch (error: unknown) {
        outcome = { exitCode: -1, outputTail: '', spawnError: error instanceof Error ? error.message : String(error) }
      }

      const verdict = await rollbackShadow(ctx, cwd, worktreePath, branch, args.keepWorktree === true, caps)
      if (verdict.kind === 'failed') {
        throw new Error(`git_shadow_run: rollback failed — ${verdict.message} — manual cleanup needed: worktree ${worktreePath}, branch ${branch}`)
      }
      return {
        exitCode: outcome.exitCode,
        worktreePath,
        outputTail: renderShadowTail(outcome),
        branch,
        rolledBack: verdict.kind === 'rolled-back',
      }
    },
    presentCall(args): TerminalCallView {
      return { card: 'terminal', title: `git_shadow_run ${args.command.join(' ')}` }
    },
    presentResult(_args, result): TerminalResultView | undefined {
      return terminalResult('git shadow run', result)
    },
  }))
}
