/**
 * Dynamic per-session model routing. Registers a `set_model_hint` tool that
 * the model can call to steer its own future steps to a different provider and
 * model, plus a `list_model_routes` tool so it can discover what is actually
 * registered instead of guessing ids.
 *
 * The `agent/request` listener is registered on the HOST context, which makes
 * it the OUTERMOST listener in the waterfall: `vendor/cordis/src/events.ts`
 * shifts hooks in registration order, and this row mounts before any Agent
 * exists, so `installModelSelection` (registered on the agent-scoped context at
 * agent creation) runs INSIDE our `await next()`. We therefore see its applied
 * selection and get the final say.
 *
 * Hint scopes:
 *   'next'    — applies to the next model call only.
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

/** Where in the turn a `'next'`-scoped hint was first applied. */
interface AppliedAt {
  turn: number
  step: number
}

interface RoutingHint {
  provider?: string
  model: string
  reasoningEffort?: ReasoningEffortId
  scope: 'next' | 'session'
  /**
   * For `'next'` hints only: the step that first consumed this hint. A retry of
   * that same step re-enters the `agent/request` waterfall, so keying on the
   * step (rather than deleting on first sight) keeps a retry on the requested
   * model instead of silently falling back to the default.
   */
  appliedAt?: AppliedAt
}

const VALID_EFFORTS: readonly string[] = ['off', 'low', 'high', 'max']

export function apply(ctx: Context): void {
  /**
   * Routing hints per session id. Wrapped in `ctx.effect` so the map is
   * dropped when this plugin's fiber unloads — otherwise a `'session'` hint
   * would outlive its session and silently re-apply on resume, since session
   * ids are stable across restarts.
   */
  const hints = new Map<string, RoutingHint>()
  ctx.effect(() => () => { hints.clear() }, 'model-router.hints')

  ctx.tools.register(defineTool({
    name: 'list_model_routes',
    description:
      'List the provider routes currently registered in this harness, for use as the '
      + '`provider` argument to set_model_hint. Call this before set_model_hint rather than '
      + 'guessing a provider id.',
    parameters: {},
    output: {
      schema: { type: 'string' } as const,
      render: (_args, value) => [{ type: 'text' as const, text: value }],
    },
    async execute() {
      const providers = ctx.llm.listProviders()
      if (providers.length === 0) return 'no provider routes are registered'
      const lines = await Promise.all(providers.map(async (provider) => {
        try {
          const models = await ctx.llm.listModels(provider.id)
          const ids = models.map(model => model.id).join(', ')
          return `${provider.id} (${provider.name}): ${ids === '' ? '(no models reported)' : ids}`
        } catch {
          // A route whose adapter cannot enumerate models is still routable.
          return `${provider.id} (${provider.name}): (model list unavailable)`
        }
      }))
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'set_model_hint',
    description:
      'Route future model calls in this session to a specific provider and model. '
      + 'Use scope "next" to switch for the next model call only (e.g. one cheap '
      + 'summarisation step), "session" to hold the route for all remaining steps, or '
      + '"clear" to restore the default model. Takes effect on the next model request '
      + 'after this call returns. Call list_model_routes first to get valid provider ids. '
      + 'Per-tool routing is not possible within one agent — delegate to a subagent with '
      + 'its own model for that instead.',
    parameters: {
      scope: {
        type: 'string',
        required: true,
        enum: ['next', 'session', 'clear'],
        description: '"next" (one call), "session" (rest of session), or "clear" (restore default).',
      },
      provider: {
        type: 'string',
        description: 'Registered provider route id, from list_model_routes. Omit to keep the current provider.',
      },
      model: {
        type: 'string',
        description: 'Provider-specific model id. Required when scope is "next" or "session".',
      },
      reasoningEffort: {
        type: 'string',
        enum: ['off', 'low', 'high', 'max'],
        description: 'Reasoning effort for the target model. Omit to use the provider default.',
      },
    },
    output: {
      schema: { type: 'string' } as const,
      render: (_args, value) => [{ type: 'text' as const, text: value }],
    },
    // defineTool's execute contract is Promise-returning; this body needs no await.
    // oxlint-disable-next-line typescript/require-await
    async execute(args, exec) {
      const sessionId = exec.agent?.session.id
      if (sessionId === undefined) return 'no calling agent — routing hint not stored'

      if (args.scope === 'clear') {
        const had = hints.delete(sessionId)
        return had ? 'routing hint cleared — default model restored' : 'no routing hint was set'
      }

      if (args.model === undefined || args.model === '') {
        return 'model is required when scope is "next" or "session"'
      }

      // Validate the provider HERE rather than letting it reach the loop. An
      // unregistered provider survives `prepareCall` (which tolerates
      // NO_ADAPTER for middleware-served routes) and then fails terminally
      // inside `llm.stream`, ending the whole turn — so a single bad id would
      // be unrecoverable rather than a mistake the model can correct.
      if (args.provider !== undefined && args.provider !== '') {
        const known = ctx.llm.listProviders().map(provider => provider.id)
        if (!known.includes(args.provider)) {
          return `unknown provider "${args.provider}" — registered routes are: ${known.join(', ')}`
        }
      }

      const effort = args.reasoningEffort !== undefined && VALID_EFFORTS.includes(args.reasoningEffort)
        ? args.reasoningEffort as ReasoningEffortId
        : undefined

      hints.set(sessionId, {
        model: args.model,
        scope: args.scope === 'next' ? 'next' : 'session',
        ...(args.provider !== undefined && args.provider !== '' ? { provider: args.provider } : {}),
        ...(effort !== undefined ? { reasoningEffort: effort } : {}),
      })

      return (
        `routing hint set: scope=${args.scope}`
        + ` provider=${args.provider ?? '(unchanged)'}`
        + ` model=${args.model}`
        + ` reasoningEffort=${effort ?? '(provider default)'}`
      )
    },
    presentCall: args => ({
      card: 'generic' as const,
      title: 'set_model_hint',
      kind: 'execute' as const,
      rawInput: args.scope,
      content: [{ type: 'text' as const, text: `Route ${args.scope}: ${args.model ?? '(clear)'}` }],
    }),
  }))

  // Outermost in the waterfall (see the module doc): `await next()` yields the
  // config installModelSelection already applied, and our return overrides it.
  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    const config: LlmCallConfig = await next()
    const sessionId = agent.session.id
    const hint = hints.get(sessionId)
    if (hint === undefined) return config

    if (hint.scope === 'next') {
      if (hint.appliedAt === undefined) {
        // First sight: bind the hint to this step so retries of it still route.
        hint.appliedAt = { turn, step }
      } else if (hint.appliedAt.turn !== turn || hint.appliedAt.step !== step) {
        // A different step — the one-shot hint is spent.
        hints.delete(sessionId)
        return config
      }
    }

    return {
      ...config,
      ...(hint.provider !== undefined ? { provider: hint.provider } : {}),
      model: hint.model,
      ...(hint.reasoningEffort !== undefined ? { reasoningEffort: hint.reasoningEffort } : {}),
    }
  })
}
