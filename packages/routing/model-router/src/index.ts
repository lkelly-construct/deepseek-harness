/**
 * Dynamic per-session model routing. Registers a `set_model_hint` tool that
 * the model can call to steer its own future steps to a different provider and
 * model. The host-plane `agent/request` listener (outermost in the waterfall)
 * reads the hint and overrides the config after `installModelSelection` runs.
 *
 * Hint scopes:
 *   'next'    — consumed after the very next model call; one-shot override.
 *   'session' — held for all remaining steps in this session until cleared.
 *   'clear'   — remove any active hint (restores default routing).
 *
 * @module @deepseek-ai/dsh-model-router
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'model-router'
export const inject = ['tools', 'llm']

interface RoutingHint {
  provider?: string
  model: string
  reasoningEffort?: ReasoningEffortId
  scope: 'next' | 'session'
}

const VALID_EFFORTS = new Set(['off', 'low', 'high', 'max'])

export function apply(ctx: Context): void {
  // Per-session routing hints keyed by session id (string).
  const hints = new Map<string, RoutingHint>()

  ctx.tools.register(defineTool({
    name: 'set_model_hint',
    description:
      'Dynamically route future model calls in this session to a specific provider and model. '
      + 'Use scope "next" to switch for one step only (e.g. a cheap summarisation step), '
      + '"session" to hold the route for all remaining steps, or "clear" to restore the '
      + 'default model. The change takes effect on the very next model request after this '
      + 'tool call completes. Per-tool routing is not possible within a single agent — '
      + 'use a subagent with agentOptions.model for that instead.',
    parameters: {
      scope: {
        type: 'string',
        required: true,
        description: '"next" (one step), "session" (rest of session), or "clear" (restore default).',
      },
      provider: {
        type: 'string',
        description: 'Registered provider name (e.g. "deepseek-official", "pi-ai"). Omit to keep current provider.',
      },
      model: {
        type: 'string',
        description: 'Provider-specific model id. Required when scope is "next" or "session".',
      },
      reasoningEffort: {
        type: 'string',
        description: 'Reasoning effort: "off", "low", "high", or "max". Omit to use provider default.',
      },
    },
    output: {
      schema: { type: 'string' } as const,
      render: (_args, value) => [{ type: 'text' as const, text: value }],
    },
    async execute(args, exec) {
      const sid = (exec.agent?.session as { id?: string } | undefined)?.id
      if (sid === undefined) {
        return 'no agent context — hint not stored'
      }

      if (args.scope === 'clear') {
        hints.delete(sid)
        return 'routing hint cleared — default model restored'
      }

      if (args.scope !== 'next' && args.scope !== 'session') {
        return `unknown scope "${args.scope}" — use "next", "session", or "clear"`
      }

      if (args.model === undefined || args.model === '') {
        return 'model is required when scope is "next" or "session"'
      }

      const effort =
        args.reasoningEffort !== undefined && VALID_EFFORTS.has(args.reasoningEffort)
          ? args.reasoningEffort as ReasoningEffortId
          : undefined

      const hint: RoutingHint = {
        model: args.model,
        scope: args.scope,
        ...(args.provider !== undefined && args.provider !== '' ? { provider: args.provider } : {}),
        ...(effort !== undefined ? { reasoningEffort: effort } : {}),
      }

      hints.set(sid, hint)

      return (
        `routing hint set: scope=${args.scope} `
        + `provider=${hint.provider ?? '(unchanged)'} `
        + `model=${hint.model} `
        + `reasoningEffort=${hint.reasoningEffort ?? '(provider default)'}`
      )
    },
    presentCall: args => ({
      card: 'generic' as const,
      title: 'set_model_hint',
      kind: 'execute' as const,
      rawInput: args.scope,
      content: [{ type: 'text' as const, text: `Route ${args.scope}: ${args.model ?? 'clear'}` }],
    }),
  }))

  // Registered on host context → outermost in the agent/request waterfall.
  // Calls next() first so installModelSelection (agent-scoped, inner) applies
  // its selection, then overrides the result when a hint is active.
  ctx.on('agent/request', async ({ agent }, next) => {
    const config: LlmCallConfig = await next()
    const sid = (agent.session as { id?: string } | undefined)?.id
    if (sid === undefined) return config
    const hint = hints.get(sid)
    if (hint === undefined) return config

    if (hint.scope === 'next') hints.delete(sid)

    return {
      ...config,
      ...(hint.provider !== undefined ? { provider: hint.provider } : {}),
      model: hint.model,
      ...(hint.reasoningEffort !== undefined ? { reasoningEffort: hint.reasoningEffort } : {}),
    }
  })
}
