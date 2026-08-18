/**
 * Model-facing memory tools.
 *
 * Both tools resolve the workspace from the calling agent's session cwd (the
 * same derivation `dsh-tool-fs`' `sessionCwd` uses), then invalidate that
 * workspace's cache so the next system-prompt assembly re-reads the files.
 * @module @deepseek-ai/dsh-memory-local/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { deleteMemory, writeMemory } from './store.ts'

/** Drop one workspace's cached rendered memory, so the next assembly re-reads it. */
export type InvalidateCache = (cwd: string) => void

/**
 * The workspace a memory call targets: the calling agent's session cwd, or the
 * process cwd when the call has no owning agent.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the session workspace to scope memory files to.
 */
function workspaceOf(exec: ToolExecution): string {
  return exec.agent?.session.header.cwd ?? process.cwd()
}

/**
 * Register the `save_memory` and `forget_memory` tools.
 * @param ctx - an agent scope context carrying the tool registry.
 * @param invalidate - cache-invalidation callback per written workspace.
 */
export function registerMemoryTools(ctx: Context, invalidate: InvalidateCache): void {
  ctx.tools.register(defineTool({
    name: 'save_memory',
    description: 'Persist a durable fact for the current workspace so future sessions in this '
      + 'workspace remember it. Reads the memory back in the system prompt from the next turn.',
    parameters: {
      slug: {
        type: 'string',
        required: true,
        description: 'A stable identifier for this memory; writing the same slug replaces it.',
      },
      type: {
        type: 'string',
        required: true,
        description: 'A short classification for the memory, e.g. "preference" or "decision".',
      },
      content: {
        type: 'string',
        required: true,
        description: 'The fact or instruction to remember.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slug: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Saved memory "${value.slug}" for this workspace.`,
      }],
    },
    execute: async (args, exec) => {
      const cwd = workspaceOf(exec)
      await writeMemory(cwd, args.slug, args.type, args.content)
      invalidate(cwd)
      return { slug: args.slug }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'forget_memory',
    description: 'Remove a previously saved memory for the current workspace by its slug. '
      + 'No-op when the memory does not exist.',
    parameters: {
      slug: {
        type: 'string',
        required: true,
        description: 'The identifier of the memory to remove.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slug: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Forgot memory "${value.slug}".`,
      }],
    },
    execute: async (args, exec) => {
      const cwd = workspaceOf(exec)
      await deleteMemory(cwd, args.slug)
      invalidate(cwd)
      return { slug: args.slug }
    },
  }))
}
