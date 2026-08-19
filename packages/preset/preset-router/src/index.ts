/**
 * Model-backed routing of a blank session's first prompt to the best-suited
 * agent preset. The caller (the Web gateway's `session.prompt` path) consults
 * this service before `followup`, then applies the returned preset id through
 * the agent-presets `recompose` seam and records the selection the same way a
 * manual pick does. Classification is best-effort: any failure or unclear
 * answer leaves the session on its default preset, so a router problem never
 * blocks a human's first message.
 * @module @deepseek-ai/dsh-preset-router
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import type { Session } from '@deepseek-ai/dsh-session'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Exact model-visible request recorded before one auxiliary preset-route dispatch. */
export interface PresetRouteLlmRequestEventData {
  /** Exact auxiliary LLM route. */
  readonly route: PresetRouteSelection
  /** Exact auxiliary system prompt. */
  readonly system: string
  /** Exact auxiliary message list. */
  readonly messages: Message[]
  /** Exact auxiliary output-token cap. */
  readonly maxTokens: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Log-only pre-dispatch record of one preset-classification model request.
     * The auxiliary request is model-visible, so the repo's model-visible ⟺
     * logged rule requires it to be reconstructable from the session log.
     */
    'preset-route/llm-request': PresetRouteLlmRequestEventData
  }
}

/** A provider/model pair the classifier may run on. */
export interface PresetRouteSelection {
  readonly provider: string
  readonly model: string
}

/** One prompt part in the caller's own vocabulary; only text parts are classified. */
export interface PresetRoutePromptPart {
  readonly type: string
  readonly text?: string
}

/** The classifier input for one blank session's first prompt. */
export interface PresetRouteRequest {
  /** The blank session being routed; its event log receives the model-visible record. */
  readonly session: Session
  /** The first prompt content, exactly as the caller is about to deliver. */
  readonly content: readonly PresetRoutePromptPart[]
  /** The caller's current model selection, the classifier's default route. */
  readonly route: PresetRouteSelection
  /** Optional cancellation for the auxiliary request. */
  readonly signal?: AbortSignal
}

/** Deployment policy for one model-backed preset router. */
export interface PresetRouterConfig {
  /** Maximum UTF-8 bytes in the final JSON-framed user prompt. */
  readonly maxInputBytes: number
  /** Auxiliary generation output-token cap. */
  readonly maxOutputTokens: number
  /** End-to-end auxiliary request deadline in milliseconds. */
  readonly timeoutMs: number
  /** Optional explicit provider route; must be paired with `model`. */
  readonly provider?: string
  /** Optional explicit model id; must be paired with `provider`. */
  readonly model?: string
}

/** Validated immutable model-provider policy. */
export type ResolvedPresetRouterConfig = PresetRouterConfig

/** Capability-owned timeout reason code for auxiliary preset routing. */
export const PRESET_ROUTE_TIMEOUT_CODE = 'PRESET_ROUTE_TIMEOUT'

/** Deterministic answer the router treats as "keep the deployment default". */
const DECLINE_ANSWER = 'DEFAULT'

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'maxInputBytes',
  'maxOutputTokens',
  'timeoutMs',
  'provider',
  'model',
])

/** Validate one positive integer limit. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`preset-router: ${name} must be a positive integer`)
  }
}

/**
 * Validate and detach required model-provider configuration.
 * @param config - untrusted plugin configuration.
 * @returns immutable policy with optional route absence preserved.
 */
export function resolvePresetRouterConfig(config: PresetRouterConfig): ResolvedPresetRouterConfig {
  const candidate: unknown = config
  if (candidate === null || typeof candidate !== 'object') {
    throw new Error('preset-router: configuration is required')
  }
  const value = candidate as PresetRouterConfig
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`preset-router: unknown config key "${key}"`)
  }
  assertPositiveInteger('maxInputBytes', value.maxInputBytes)
  assertPositiveInteger('maxOutputTokens', value.maxOutputTokens)
  assertPositiveInteger('timeoutMs', value.timeoutMs)
  if (value.timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`preset-router: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  const hasProvider = value.provider !== undefined
  const hasModel = value.model !== undefined
  if (hasProvider !== hasModel) {
    throw new Error('preset-router: provider and model must be supplied together')
  }
  if (hasProvider) {
    if (typeof value.provider !== 'string' || value.provider.length === 0
      || typeof value.model !== 'string' || value.model.length === 0) {
      throw new Error('preset-router: provider and model overrides must be non-empty strings')
    }
  }
  return deepFreeze({ ...value })
}

/** Resolve the explicit pair or fall back to the caller's model selection. */
function resolveRoute(
  config: ResolvedPresetRouterConfig,
  fallback: PresetRouteSelection,
): PresetRouteSelection {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  return fallback
}

/** Frame the roster so the model answers only real ids, and the JSON cannot break delimiters. */
function systemPrompt(roster: readonly AgentPreset[]): string {
  const framed = JSON.stringify(roster.map(({ id, name, description }) => ({
    id,
    ...name === undefined ? {} : { name },
    ...description === undefined ? {} : { description },
  })))
  return [
    'You route one human request to the single best-suited agent preset of the DeepSeek Harness.',
    `Available presets (JSON): ${framed}`,
    'Reply with exactly one id from that JSON list, and nothing else: no quotes, no backticks, no explanation, no punctuation.',
    `If no preset fits the request, reply with exactly: ${DECLINE_ANSWER}`,
  ].join('\n')
}

/** Concatenate the text parts of a prompt, dropping images and other non-text blocks. */
function textBlocks(content: readonly PresetRoutePromptPart[]): string {
  return content
    .filter(part => part.type === 'text')
    .map(part => part.text ?? '')
    .join('\n')
    .trim()
}

/** Frame human text as JSON so user content cannot break structural delimiters. */
function frameRequest(text: string): string {
  return JSON.stringify({ request: text })
}

/** Translate terminal finish reasons into an auxiliary-call failure. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('preset-router: classifier output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('preset-router: classifier unexpectedly requested a tool')
    default:
      return new Error(`preset-router: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/** Turn classifier text into a roster id, or undefined to keep the default. */
function parsePresetChoice(text: string, roster: readonly AgentPreset[]): string | undefined {
  const cleaned = text.trim()
    .replace(/```[a-z]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/^["']|["']$/g, '')
    .trim()
  if (cleaned.length === 0 || cleaned.toUpperCase() === DECLINE_ANSWER) return undefined
  return roster.find(preset => preset.id === cleaned)?.id
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    presetRouter: PresetRouter
  }
}

/**
 * Registers one model-backed preset router under the `presetRouter` key.
 *
 * Consumption is optional and host-plane: the Web gateway's `session.prompt`
 * path reads `ctx.get('presetRouter')` and applies the returned id only while
 * the session is blank. The router never composes or disposes anything itself;
 * it resolves the roster and returns a choice, leaving the swap to its caller,
 * so it stays swappable and never races a session's lifecycle.
 */
export default class PresetRouter extends Service {
  /** Requires the shared LLM capability to make the auxiliary classification call. */
  static inject = ['llm']

  /** Shared Loader field schema with no library defaults. */
  static Config = z.object({
    maxInputBytes: z.number().step(1).min(1).required(),
    maxOutputTokens: z.number().step(1).min(1).required(),
    timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
    provider: z.string(),
    model: z.string(),
  }) as z<PresetRouterConfig>

  private readonly resolved: ResolvedPresetRouterConfig

  constructor(ctx: Context, config: PresetRouterConfig) {
    super(ctx, 'presetRouter')
    this.resolved = resolvePresetRouterConfig(config)
  }

  /**
   * Classify one blank session's first prompt into an agent preset id.
   *
   * Best-effort: any failure — an unavailable roster, an over-long or
   * image-only prompt, a timeout, a non-`DEFAULT` unknown answer — returns
   * `undefined`, never throws, so the caller always proceeds with the default.
   * The exact auxiliary model request is logged to the session before dispatch.
   * @param request - the blank session, the first prompt, and the candidate route.
   * @returns the preset id to compose from, or `undefined` to keep the default.
   */
  async routeForPrompt(request: PresetRouteRequest): Promise<string | undefined> {
    request.signal?.throwIfAborted()
    try {
      const presets = this.ctx.get('agentPresets')
      if (presets === undefined) return undefined
      const roster = (await presets.list()).filter(preset => preset.broken === undefined)
      if (roster.length === 0) return undefined
      const text = textBlocks(request.content)
      if (text.length === 0) return undefined
      const framed = frameRequest(text)
      if (Buffer.byteLength(framed, 'utf8') > this.resolved.maxInputBytes) return undefined
      const route = resolveRoute(this.resolved, request.route)
      const system = systemPrompt(roster)
      const messages: Message[] = [createUserMessage({
        content: [{ type: 'text', text: framed }],
        source: { kind: 'plugin', plugin: 'dsh-preset-router' },
      })]
      request.session.append('preset-route/llm-request', {
        route,
        system,
        messages,
        maxTokens: this.resolved.maxOutputTokens,
      })
      using callDeadline = deadline(
        request.signal ?? new AbortController().signal,
        this.resolved.timeoutMs,
        PRESET_ROUTE_TIMEOUT_CODE,
      )
      const options: GenerateOptions = deepFreeze({
        provider: route.provider,
        model: route.model,
        messages,
        system,
        maxTokens: this.resolved.maxOutputTokens,
        purpose: 'preset-route',
        sessionId: request.session.id,
        signal: callDeadline.signal,
      })
      callDeadline.signal.throwIfAborted()
      const assembler = new BlockAssembler()
      for await (const chunk of this.ctx.llm.stream(options)) {
        callDeadline.signal.throwIfAborted()
        assembler.push(chunk)
      }
      callDeadline.signal.throwIfAborted()
      const terminalError = finishError(assembler.finish)
      if (terminalError !== undefined) throw terminalError
      const blocks = assembler.blocks()
      if (blocks.some(block => block.type === 'tool-call')) {
        throw new Error('preset-router: classifier output must contain text only')
      }
      const answer = blocks
        .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join(' ')
      return parsePresetChoice(answer, roster)
    } catch (error) {
      this.ctx.logger.warn(
        `preset-router: auto-selection skipped for session "${request.session.id}": ${String(error)}`,
      )
      return undefined
    }
  }
}
