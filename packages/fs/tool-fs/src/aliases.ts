/**
 * Tolerant name aliases for the canonical `read`/`write`/`edit` tools.
 * Weaker models sometimes guess conventional-sounding names (`read_file`,
 * `write_file`, `edit_file`) instead of the ones actually declared in the
 * schema; rather than a bare `unknown tool` rejection, these register the
 * same behavior under the guessed name and the guessed `path` argument, so
 * the call succeeds instead of round-tripping a failure and a retry.
 * @module @deepseek-ai/dsh-tool-fs/src/aliases
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffCallView, DiffResultView, GenericCallView, ReadResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { computeHunkDiffs, diffsFromMeta } from './diff.ts'
import { remediateFsError } from './error.ts'
import { formatEditOutput, parseEditArgs } from './edit.ts'
import { formatWriteOutput, parseWriteArgs } from './write.ts'
import { buildWindow, formatReadOutput, langFromPath, readMetaFromMeta } from './read-render.ts'
import { resolveRegularReadTarget } from './read-target.ts'
import type { ReadToolCaps } from './read.ts'
import { parseReadArgs } from './read.ts'
import { sessionResolveOptions } from './session-cwd.ts'
import type { FsSandboxController } from './sandbox.ts'

/** Register `read_file` as an alias of `read` (argument `path` maps to `file_path`). */
export function applyReadFileAlias(ctx: Context, caps: ReadToolCaps): void {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Alias of `read`. Prefer `read` — this name is accepted for models that guess it.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path to read, resolved by the filesystem backend.' },
      offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
      limit: { type: 'number', description: `Maximum number of lines to return. Defaults to ${caps.limit}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          lines: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
          totalLines: { type: 'integer', required: true },
        },
      },
      render: (args, value) => {
        const input = parseReadArgs({
          file_path: args.path,
          ...args.offset === undefined ? {} : { offset: args.offset },
          ...args.limit === undefined ? {} : { limit: args.limit },
        }, caps.limit)
        const endLine = value.lines.at(-1)?.number ?? Math.max(0, value.offset - 1)
        const truncatedByBytes = value.lines.length < input.limit && endLine < value.totalLines
        return [{
          type: 'text',
          text: formatReadOutput(value.path, {
            offset: value.offset,
            lines: value.lines,
            totalLines: value.totalLines,
            ...truncatedByBytes ? { truncatedByBytes: true } : {},
          }),
        }]
      },
      presentationMeta: (_args, value) => {
        const lang = langFromPath(value.path)
        return {
          path: value.path,
          offset: value.offset,
          lines: value.lines.map(({ number, text }) => ({ number, text })),
          totalLines: value.totalLines,
          ...lang === undefined ? {} : { lang },
        }
      },
    },
    isConcurrencySafe: () => true,
    async execute(args: { path: string; offset?: number; limit?: number }, exec) {
      const input = parseReadArgs({
        file_path: args.path,
        ...args.offset === undefined ? {} : { offset: args.offset },
        ...args.limit === undefined ? {} : { limit: args.limit },
      }, caps.limit)
      const { target, info } = await resolveRegularReadTarget(ctx, exec, input.filePath)
      const chunks = info.size === undefined || info.size >= caps.streamMinSize
        ? await ctx.fs.streamText(target, exec.signal)
        : [await ctx.fs.readText(target, exec.signal)]
      const window = await buildWindow(
        chunks,
        { offset: input.offset, limit: input.limit, maxLineLength: caps.maxLineLength, maxBytes: caps.maxBytes },
        target.displayPath,
      )
      const outcome = { path: target.displayPath, offset: input.offset, lines: window.lines, totalLines: window.totalLines }
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return outcome
    },
    presentResult(_args, result: ToolResult): ReadResultView | undefined {
      if (result.isError) return undefined
      const meta = readMetaFromMeta(result.meta)
      if (meta === undefined) return undefined
      const only = result.content.length === 1 ? result.content[0] : undefined
      const text = only?.type === 'text' ? only.text : undefined
      if (text === undefined) return undefined
      const body = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
      if (body === undefined) return undefined
      return {
        card: 'read',
        path: meta.path,
        offset: meta.offset,
        lines: meta.lines,
        totalLines: meta.totalLines,
        ...meta.lang === undefined ? {} : { lang: meta.lang },
        content: [{ type: 'text', text: body }],
      }
    },
    presentCall(args): GenericCallView {
      const { offset, limit } = args
      const window = limit !== undefined && limit > 0
        ? ` (${offset ?? 1} - ${(offset ?? 1) + limit - 1})`
        : offset !== undefined ? ` (from line ${offset})` : ''
      return { card: 'generic', title: `Read ${args.path}${window}`, kind: 'read', locations: [{ path: args.path, line: offset ?? 1 }] }
    },
  }))
}

/** Register `write_file` as an alias of `write` (argument `path` maps to `file_path`). */
export function applyWriteFileAlias(ctx: Context, sandbox: FsSandboxController): void {
  ctx.tools.register(defineTool({
    name: 'write_file',
    description: 'Alias of `write`. Prefer `write` — this name is accepted for models that guess it.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path to write, resolved by the filesystem backend.' },
      content: { type: 'string', required: true, description: 'Full UTF-8 text content to write.' },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          operation: { type: 'string', required: true, enum: ['create', 'update'] },
          before: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          after: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatWriteOutput(value.path, value) }],
      presentationMeta: (args, value) => ({
        diffs: value.before === null
          ? []
          : computeHunkDiffs(args.path, value.before, value.after).map(({ path, oldText, newText }) => ({ path, oldText, newText })),
      }),
    },
    async execute(args: { path: string; content: string; sandbox_permissions?: string; justification?: string }, exec) {
      const input = parseWriteArgs({ file_path: args.path, content: args.content })
      const sandboxPolicy = await sandbox.resolvePolicy('write', args, exec)
      const target = await ctx.fs.resolve(input.filePath, sessionResolveOptions(exec, input.filePath, sandboxPolicy?.workspaceRoot))
      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
      let outcome
      try {
        outcome = await ctx.fs.writeText(target, input.content, intent, exec.signal, sandboxPolicy)
      } catch (error: unknown) {
        throw remediateFsError(sandbox.mapError(error, sandboxPolicy))
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      return { path: target.displayPath, operation: outcome.operation, before: outcome.before, after: outcome.after }
    },
    presentCall(args): DiffCallView {
      return {
        card: 'diff',
        title: `Write ${args.path}`,
        diffs: [{ path: args.path, oldText: null, newText: args.content }],
        locations: [{ path: args.path }],
      }
    },
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const diffs = diffsFromMeta(result.meta) ?? [{ path: args.path, oldText: null, newText: args.content }]
      return { card: 'diff', title: `Write ${args.path}`, diffs }
    },
  }))
}

/** Register `edit_file` as an alias of `edit` (argument `path` maps to `file_path`). */
export function applyEditFileAlias(ctx: Context, sandbox: FsSandboxController): void {
  ctx.tools.register(defineTool({
    name: 'edit_file',
    description: 'Alias of `edit`. Prefer `edit` — this name is accepted for models that guess it.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path to edit, resolved by the filesystem backend.' },
      old_string: { type: 'string', required: true, description: 'Literal text to replace. Must match exactly.' },
      new_string: { type: 'string', required: true, description: 'Literal replacement text. Use an empty string to delete the match.' },
      replace_all: {
        type: 'boolean',
        description: 'Replace all matches. Defaults to false; when false, old_string must appear exactly once.',
      },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          before: { type: 'string', required: true },
          after: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{ type: 'text', text: formatEditOutput(value.path, args.replace_all ?? false) }],
      presentationMeta: (args, value) => ({
        diffs: computeHunkDiffs(args.path, value.before, value.after).map(({ path, oldText, newText }) => ({ path, oldText, newText })),
      }),
    },
    async execute(args: {
      path: string
      old_string: string
      new_string: string
      replace_all?: boolean
      sandbox_permissions?: string
      justification?: string
    }, exec) {
      const input = parseEditArgs({
        file_path: args.path,
        old_string: args.old_string,
        new_string: args.new_string,
        ...args.replace_all === undefined ? {} : { replace_all: args.replace_all },
      })
      const sandboxPolicy = await sandbox.resolvePolicy('edit', args, exec)
      const target = await ctx.fs.resolve(input.filePath, sessionResolveOptions(exec, input.filePath, sandboxPolicy?.workspaceRoot))
      let outcome
      try {
        const intent = await ctx.waterfall('fs/edit-intent', target, exec, () => undefined)
        outcome = await ctx.fs.editText(
          target,
          { oldString: input.oldString, newString: input.newString, replaceAll: input.replaceAll },
          intent,
          exec.signal,
          sandboxPolicy,
        )
      } catch (error: unknown) {
        throw remediateFsError(sandbox.mapError(error, sandboxPolicy))
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      return { path: target.displayPath, before: outcome.before, after: outcome.after }
    },
    presentCall(args): DiffCallView {
      return {
        card: 'diff',
        title: `Edit ${args.path}`,
        diffs: [{ path: args.path, oldText: args.old_string || null, newText: args.new_string }],
        locations: [{ path: args.path }],
      }
    },
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const diffs = diffsFromMeta(result.meta)
      if (diffs === undefined) return undefined
      return { card: 'diff', title: `Edit ${args.path}`, diffs }
    },
  }))
}
