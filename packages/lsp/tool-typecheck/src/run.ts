/**
 * One foreground `tsc --noEmit --pretty false` run through `ctx.subprocess`, owning the fixed argv,
 * the collected stdout/stderr budgets, signal forwarding, and exit/cancellation classification.
 * The result is the parsed diagnostics — never fused into the LSP seam.
 * @module @deepseek-ai/dsh-tool-typecheck/run
 */

import type { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { LspDiagnostic } from '@deepseek-ai/dsh-lsp'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { parseTscOutput } from './parse.ts'

/** The budgets and grace one typecheck run needs beyond the tool's resolved config. */
export interface TypecheckRunConfig {
  /** Largest collected tsc stdout in bytes; overflow keeps the tail. */
  readonly maxOutputBytes: number
  /** Largest retained tsc stderr tail in bytes. */
  readonly maxStderrBytes: number
  /** SIGTERM→SIGKILL escalation grace for the subprocess service. */
  readonly graceMs: number
}

/**
 * Run `tsc --noEmit --pretty false` in `workspaceRoot` and parse the diagnostics. A clean exit (0)
 * returns `[]`; a nonzero exit still returns whatever diagnostics parsed; when a nonzero exit
 * produced none (e.g. a config error), the call fails with the stderr excerpt. Abort and
 * signal-kill both fail the call — never a silent empty result.
 * @param ctx - the plugin context carrying the subprocess service.
 * @param workspaceRoot - the call's session workspace cwd (the spawn cwd).
 * @param project - the tsconfig path passed as `-p` (defaults to `tsconfig.json`).
 * @param config - the resolved run budgets.
 * @param signal - optional tool cancellation, forwarded to the spawn spec.
 * @returns the parsed diagnostics.
 */
export async function runTypecheck(
  ctx: Context,
  workspaceRoot: string,
  project: string,
  config: TypecheckRunConfig,
  signal?: AbortSignal,
): Promise<LspDiagnostic[]> {
  // Resolve before spawn so a missing tsc on the execution world's PATH fails the tool call with
  // a resolvable message instead of surfacing a spawn-level rejection. On Windows, `resolveExecutable`
  // returns `.cmd`/`.ps1` PATH shims, which the subprocess provider cannot exec directly (EINVAL);
  // run the typescript bin through the real `node` executable instead, resolving the bin from the
  // session workspace so the tool works with the workspace's own TypeScript install.
  const node = await ctx.subprocess.resolveExecutable('node')
  const tscBin = resolveTypescriptBin(workspaceRoot)
  const collect = { maxBytes: config.maxOutputBytes } as const
  const handle = ctx.subprocess.spawn({
    argv: [node, tscBin, '--noEmit', '--pretty', 'false', '-p', project],
    cwd: workspaceRoot,
    stdio: {
      stdin: 'ignore',
      stdout: collect,
      stderr: { maxBytes: config.maxStderrBytes },
    },
    graceMs: config.graceMs,
    ...signal !== undefined ? { signal } : {},
  })
  const outcome = await handle.done
  if (signal?.aborted) {
    throw new Error('typecheck aborted before tsc finished')
  }
  if (outcome.signal !== null) {
    throw new Error(`typecheck was killed by ${outcome.signal}`)
  }
  const stdout = readText(handle, 'stdout')
  const stderr = readText(handle, 'stderr')
  const diagnostics = parseTscOutput(stdout)
  if (outcome.exitCode !== 0 && diagnostics.length === 0) {
    throw new Error(`tsc exited with ${outcome.exitCode} and no diagnostics; stderr: ${stderr.trim()}`)
  }
  return diagnostics
}

/** Read one collect-mode stream from 0 after settlement (readers exist by the spawn contract). */
function readText(handle: SubprocessHandle, name: 'stdout' | 'stderr'): string {
  const reader = handle.collected[name]
  /* v8 ignore next -- collect dispositions expose both readers by the seam contract; defensive. */
  if (reader === undefined) throw new Error('tool-typecheck: subprocess implementation dropped a requested collect stream')
  return reader.readFrom(0).text
}

/**
 * Resolve the typescript CLI entry from the session workspace so the tool runs the workspace's own
 * TypeScript instead of a PATH shim. Fails loud when the workspace has no typescript dependency.
 * @param workspaceRoot - the call's session workspace cwd.
 * @returns the absolute path to `typescript/bin/tsc` (or `bin/tsc.js` on older layouts).
 */
function resolveTypescriptBin(workspaceRoot: string): string {
  const requireFromWorkspace = createRequire(resolve(workspaceRoot, 'noop.js'))
  const bin = requireFromWorkspace.resolve('typescript/bin/tsc')
  return resolve(bin)
}
