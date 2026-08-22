/**
 * Shared plugin helpers for the git tool suite: cwd resolution, shadow-root
 * resolution (`<gitDir>/dsh-shadow`), presentation, and bounded UTF-8 tail
 * trimming for shadow-run output.
 * @module @deepseek-ai/dsh-tool-git/helpers
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TerminalResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import { resolve } from 'node:path'
import { SHADOW_ROOT_NAME, formatResult, runGit } from './git.ts'

/** Resolved caps shared by the worktree and shadow-run tools. */
export interface GitToolCaps {
  /** Cooperative tool-call timeout budget (ms), enforced through `exec.signal`. */
  timeoutMs: number
  /** Max stdout bytes retained per shadow-run stream (tail-kept). */
  maxStdoutBytes: number
  /** Max stderr bytes retained per shadow-run stream (tail-kept). */
  maxStderrBytes: number
  /** Terminate-escalation grace (ms) handed to every spawned process. */
  graceMs: number
}

/** Resolve the directory git runs in: explicit workdir, else the session cwd. */
export function resolveCwd(workdir: string | undefined, agent: Agent | undefined): string {
  return workdir ?? agent?.session.header.cwd ?? process.cwd()
}

/**
 * Resolve the confined shadow root of the repository at `cwd`: the git
 * directory reported by `git rev-parse --git-dir`, joined with the fixed
 * `dsh-shadow` name. Every shadow worktree path is confined to this root.
 * @param ctx - plugin context carrying the subprocess service.
 * @param cwd - directory to resolve the repository from.
 * @param signal - cancellation signal for the git lookup.
 * @returns the canonical absolute shadow-root path.
 */
export async function resolveShadowRoot(ctx: Context, cwd: string, signal: AbortSignal): Promise<string> {
  const r = await runGit(ctx, ['rev-parse', '--git-dir'], cwd, signal)
  if (r.exitCode !== 0) throw new Error(`git: not a git repository at ${cwd}: ${formatResult(r)}`)
  const gitDir = r.stdout.trim().split(/\r?\n/)[0] ?? ''
  if (gitDir.length === 0) throw new Error('git: empty --git-dir output')
  return resolve(cwd, gitDir, SHADOW_ROOT_NAME)
}

/** Trim `text` to at most `maxBytes` UTF-8 bytes, keeping the tail. */
export function trimTailUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(bytes.length - maxBytes))
}

/** Present a completed terminal tool result, matching the git suite's cards. */
export function terminalResult(title: string, result: ToolResult): TerminalResultView | undefined {
  if (result.isError) return undefined
  const text = result.content.find(b => b.type === 'text')?.text ?? ''
  return { card: 'terminal', title, output: text }
}
