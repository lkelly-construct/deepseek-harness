/**
 * Shared git subprocess plumbing and shadow-worktree path confinement for the
 * git tool suite. Every executable git invocation goes through
 * {@link runGit}, one `ctx.subprocess.spawn` of the `git` argv vector with
 * bounded collected output and the caller's cancellation signal — never a raw
 * child-process fork.
 * @module @deepseek-ai/dsh-tool-git/git
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** Fixed sub-directory of a repository's `.git` dir that confines every shadow worktree path. */
export const SHADOW_ROOT_NAME = 'dsh-shadow'

/** Ref namespace reserved for shadow worktrees; the prefix `git branch -D` relies on. */
export const SHADOW_BRANCH_PREFIX = 'dsh-shadow/'

/**
 * Assert that a resolved candidate path lies strictly inside this repository's
 * shadow root (`<gitDir>/dsh-shadow/`). The model controls `path` on the add
 * operation, so an absolute escape, parent traversal, or a path landing on the
 * root itself is a hard execution error — never passed to git. Comparison is
 * separator-agnostic (both sides are compared with forward slashes) so the
 * check behaves identically on Windows and POSIX.
 * @param shadowRoot - canonical absolute path of the confined shadow root.
 * @param candidate - canonical absolute candidate worktree path.
 * @returns `candidate` for chaining.
 */
export function assertInsideShadowRoot(shadowRoot: string, candidate: string): string {
  const rootSlash = shadowRoot.replaceAll(/[\\/]/g, '/').replace(/\/+$/, '')
  const candidateSlash = candidate.replaceAll(/[\\/]/g, '/')
  if (candidateSlash === rootSlash || !candidateSlash.startsWith(`${rootSlash}/`)) {
    throw new Error(`git_worktree: path ${candidate} is outside the shadow root ${shadowRoot}; refusing a non-shadow worktree`)
  }
  const rest = candidateSlash.slice(rootSlash.length + 1)
  if (rest.length === 0 || rest.startsWith('..') || rest.split('/').some(part => part === '..') || rest.includes(':') || rest.includes('*') || rest.includes('?')) {
    throw new Error(`git_worktree: path ${candidate} escapes the shadow root ${shadowRoot}; refusing traversal or glob metacharacters`)
  }
  return candidate
}

/** One resolved git invocation outcome with bounded, tail-kept collected output. */
export interface GitResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function runGit(ctx: Context, argv: string[], cwd: string, signal: AbortSignal): Promise<GitResult> {
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

/** Format a git result with the package's `[exit code: N]` convention. */
export function formatResult(r: GitResult): string {
  const out = r.stdout.trim()
  const err = r.stderr.trim()
  const body = [out, err].filter(Boolean).join('\n')
  if (r.exitCode === 0) return body || '(no output)'
  return `${body}\n[exit code: ${r.exitCode}]`.trim()
}

/** True when `name` is a shadow branch (`dsh-shadow/<name>`). */
export function isShadowBranch(name: string): boolean {
  return name.startsWith(SHADOW_BRANCH_PREFIX)
}
