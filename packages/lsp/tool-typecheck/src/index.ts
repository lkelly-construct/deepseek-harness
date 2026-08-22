/**
 * Model-facing `typecheck` tool: an offline TypeScript diagnostics fallback that runs
 * `tsc --noEmit --pretty false` through the subprocess capability and parses the diagnostic lines
 * into the seam's {@link LspDiagnostic} shape (severity 1, code `TSxxxx`). It is a SEPARATE,
 * explicit tool — it never routes through `ctx.lsp`, so it works with no language server and no
 * network. The session workspace is required with no fallback (mirroring tool-lsp); presentation
 * reuses tool-lsp's diagnostics renderer so both tools print the same model-facing lines.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-typecheck
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { formatDiagnostics, sessionCwd } from '@deepseek-ai/dsh-tool-lsp'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { pathToFileURL } from 'node:url'
import { runTypecheck } from './run.ts'

export { parseTscOutput } from './parse.ts'
export { runTypecheck } from './run.ts'
export { formatDiagnostics } from '@deepseek-ai/dsh-tool-lsp'

/** Cordis plugin name for loader diagnostics. */
export const name = 'tool-typecheck'

/** Services required by this plugin. */
export const inject = ['tools', 'systemPrompt', 'subprocess']

/** Default tool-call timeout budget (ms) for one `tsc --noEmit` run. */
export const DEFAULT_TIMEOUT_MS = 120_000

/** Default cap on the complete rendered result in characters. */
export const DEFAULT_MAX_RESULT_CHARS = 16_000

/** Default cap on collected tsc stdout in bytes before tail truncation. */
export const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000

/** Default cap on the retained tsc stderr tail in bytes. */
export const DEFAULT_MAX_STDERR_BYTES = 64_000

/** Default SIGTERM→SIGKILL escalation grace for the subprocess service. */
export const DEFAULT_GRACE_MS = 3_000

/** The stable system-prompt guidance positioning typecheck as the offline fallback. */
export const TYPECHECK_PROMPT_TEXT =
  'Use typecheck to run the TypeScript compiler over the project (tsc --noEmit) when no language server reports diagnostics. When the user reports errors, a broken build, failing tests, or asks you to fix something in a TypeScript project, run typecheck first and enumerate the diagnostics before changing code. Pass project when tsconfig.json is not at the session root. The session workspace root is required; results render as diagnostics with error codes.'

/** Plugin configuration: rendering cap and the timeout budget. */
export interface Config {
  /** Largest complete rendered result in characters (default 16000). */
  maxResultChars?: number
  /** Tool-call timeout budget in ms (default 120000). */
  timeoutMs?: number
  /** Largest collected tsc stdout in bytes before tail truncation (default 1000000). */
  maxOutputBytes?: number
  /** Largest retained tsc stderr tail in bytes (default 64000). */
  maxStderrBytes?: number
  /** SIGTERM→SIGKILL escalation grace for the subprocess spawn (default 3000). */
  graceMs?: number
}

export const Config: z<Config> = z.object({
  maxResultChars: z.number().default(DEFAULT_MAX_RESULT_CHARS),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS),
  maxOutputBytes: z.number().default(DEFAULT_MAX_OUTPUT_BYTES),
  maxStderrBytes: z.number().default(DEFAULT_MAX_STDERR_BYTES),
  graceMs: z.number().default(DEFAULT_GRACE_MS),
})

type ResolvedConfig = Required<Config>

/**
 * Register the `typecheck` tool and its system-prompt guidance.
 * @param ctx - the plugin context (must inject `tools`, `systemPrompt`, `subprocess`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxResultChars', resolved.maxResultChars)
  assertPositiveInteger('maxOutputBytes', resolved.maxOutputBytes)
  assertPositiveInteger('maxStderrBytes', resolved.maxStderrBytes)
  assertTimer('timeoutMs', resolved.timeoutMs)
  assertTimer('graceMs', resolved.graceMs)

  ctx.systemPrompt.section({ name: 'tool:typecheck', order: 113, text: TYPECHECK_PROMPT_TEXT })

  ctx.tools.register(defineTool({
    name: 'typecheck',
    description: 'Run the TypeScript compiler (tsc --noEmit) over the project and return its diagnostics, without a language server or network. project is a path to the tsconfig.json to check, relative to the workspace root or absolute; defaults to tsconfig.json at the workspace root.',
    parameters: {
      project: {
        type: 'string',
        description: 'Path to the tsconfig.json to check, relative to the workspace root or absolute. Defaults to tsconfig.json at the workspace root.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'diagnostics' },
          diagnostics: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                severity: { type: 'number', enum: [1, 2, 3, 4], required: true },
                code: { type: 'string' },
                message: { type: 'string', required: true },
                range: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    start: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        line: { type: 'integer', required: true },
                        character: { type: 'integer', required: true },
                      },
                      required: true,
                    },
                    end: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        line: { type: 'integer', required: true },
                        character: { type: 'integer', required: true },
                      },
                      required: true,
                    },
                  },
                  required: true,
                },
              },
            },
          },
          resolvedWorkspaceUri: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: formatDiagnostics(value.diagnostics, resolved.maxResultChars) },
      ],
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const workspaceRoot = sessionCwd(exec)
      if (workspaceRoot === undefined) {
        throw new Error('the typecheck tool requires a session workspace cwd')
      }
      const project = typeof args.project === 'string' && args.project.trim() !== ''
        ? args.project.trim()
        : 'tsconfig.json'
      const diagnostics = await runTypecheck(ctx, workspaceRoot, project, {
        maxOutputBytes: resolved.maxOutputBytes,
        maxStderrBytes: resolved.maxStderrBytes,
        graceMs: resolved.graceMs,
      }, exec.signal)
      return {
        kind: 'diagnostics' as const,
        diagnostics,
        resolvedWorkspaceUri: pathToFileURL(workspaceRoot).href,
      }
    },
    presentCall: () => ({ card: 'generic', kind: 'execute', title: 'Typecheck (tsc --noEmit)' }),
  }))
}

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-typecheck: ${name} must be a positive integer`)
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-typecheck: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}
