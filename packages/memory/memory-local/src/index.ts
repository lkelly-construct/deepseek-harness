/**
 * `memory-local`: durable per-workspace memory contributed to the system prompt.
 *
 * A session may `save_memory` a fact and a later session in the same workspace
 * sees it under a `## Persistent memory` section. The section callback is
 * synchronous, so the workspace's files are read into an in-memory cache on
 * first assembly and re-read after a write; there is no lifecycle-event
 * preload, which would race the first assembly.
 * @module @deepseek-ai/dsh-memory-local
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import { readMemories } from './store.ts'
import { registerMemoryTools } from './tools.ts'

/** Cordis plugin name. */
export const name = 'memory-local'

/** The registries this plugin contributes to. */
export const inject = ['tools', 'systemPrompt']

/**
 * Register the persistent-memory section and its tools.
 * @param ctx - an agent scope context carrying the tool registry and prompt registry.
 */
export function apply(ctx: Context): void {
  // Rendered memory text per workspace path. Filled on first assembly for a
  // workspace and invalidated after a write, so a turn never reads stale
  // text and never waits on I/O it cannot await.
  const cache = new Map<string, string>()

  const render = (cwd: string): string => {
    const cached = cache.get(cwd)
    if (cached !== undefined) return cached
    const memories = readMemories(cwd)
    const text = memories.length === 0
      ? ''
      : `## Persistent memory\n\n${memories.join('\n\n---\n\n')}`
    cache.set(cwd, text)
    return text
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'memory:workspace',
    order: 10,
    text: (context) => {
      // Absent agent means a diagnostics assembly with no session to scope to.
      if (context.agent === undefined) return ''
      return render(context.agent.session.header.cwd ?? process.cwd())
    },
  }), 'memory.section()')

  // Tools invalidate the cache entry for the workspace they wrote to.
  registerMemoryTools(ctx, (cwd: string) => cache.delete(cwd))
}
