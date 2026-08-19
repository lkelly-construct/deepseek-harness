/**
 * The preset router classifies a blank session's first prompt through an
 * auxiliary LLM call and returns a roster id, or nothing. These tests cover
 * the classifier contract over a fake llm service, config validation, and one
 * real-composition mount against the agent-presets fixtures.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import PresetRouter, {
  resolvePresetRouterConfig,
} from '@deepseek-ai/dsh-preset-router'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../agent-presets/tests/fixtures')
const SYSTEM_ROOT = join(FIXTURES, 'system')

/** Result of a fake `llm.stream` surface: the exact request plus a fixed answer. */
interface FakeLlm {
  readonly calls: GenerateOptions[]
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/**
 * An llm surface whose stream answers every call with one fixed text, or
 * throws when the text is `THROW`. Records each exact request for assertions.
 */
function fakeLlm(answer: string): FakeLlm {
  const calls: GenerateOptions[] = []
  return {
    calls,
    stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      calls.push(options)
      return (async function* (this: { answer: string }) {
        if (this.answer === 'THROW') throw new Error('provider exploded')
        const text = this.answer
        yield { type: 'text-delta', index: 0, text } as StreamChunk
        yield { type: 'block-end', index: 0, block: { type: 'text', text } } as StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      }).call({ answer })
    },
  }
}

/** An llm surface that ends every stream with one terminal finish reason. */
function finishingLlm(reason: StreamChunk): FakeLlm {
  const calls: GenerateOptions[] = []
  return {
    calls,
    stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      calls.push(options)
      return (async function* () {
        yield reason
      })()
    },
  }
}

/** Roster double; the router reads only `list()` and the `broken` field. */
function rosterDouble(ids: readonly string[], broken: readonly string[] = []): unknown {
  return {
    list: () => Promise.resolve(ids.map(id => ({
      id,
      trust: 'system' as const,
      path: `/presets/${id}/agent.cordis.yml`,
      ...broken.includes(id) ? { broken: 'broken composition' } : {},
    }))),
  }
}

const CONFIG = { maxInputBytes: 10000, maxOutputTokens: 16, timeoutMs: 5000 }
const ROUTE = { provider: 'test', model: 'test-model' }
const TEXT_PROMPT = [{ type: 'text' as const, text: 'hi' }]

function session(id = 'sess'): Session {
  return Session.create(SessionId(id), [], { version: 0, id: SessionId(id), createdAt: 0 })
}

/** Mount the router over a fake llm and roster double. */
async function harness(
  answer: string,
  roster: readonly string[] = ['standard', 'minimal'],
  broken: readonly string[] = [],
) {
  const llm = fakeLlm(answer)
  const ctx = new Context()
  ctx.provide('llm', { stream: (options: GenerateOptions) => llm.stream(options) } as never)
  ctx.provide('agentPresets', rosterDouble(roster, broken) as never)
  const fiber = await ctx.plugin(PresetRouter, CONFIG)
  return { ctx, llm, fiber }
}

describe('resolvePresetRouterConfig', () => {
  it('rejects an unknown config key', () => {
    expect(() => resolvePresetRouterConfig({ ...CONFIG, extra: 1 } as never))
      .toThrow(/unknown config key "extra"/)
  })

  it('requires provider and model together', () => {
    expect(() => resolvePresetRouterConfig({ ...CONFIG, provider: 'deepseek' }))
      .toThrow(/provider and model must be supplied together/)
  })

  it('rejects non-positive limits and over-long timeouts', () => {
    expect(() => resolvePresetRouterConfig({ ...CONFIG, maxInputBytes: 0 }))
      .toThrow(/maxInputBytes must be a positive integer/)
    expect(() => resolvePresetRouterConfig({ ...CONFIG, timeoutMs: 2_147_483_648 }))
      .toThrow(/timeoutMs must not exceed/)
  })

  it('freezes the resolved policy', () => {
    expect(Object.isFrozen(resolvePresetRouterConfig({ ...CONFIG, provider: 'a', model: 'b' }))).toBe(true)
  })
})

describe('PresetRouter.routeForPrompt', () => {
  it('returns a roster id the classifier chose and logs the exact request', async () => {
    const { ctx, llm } = await harness('minimal')
    const sess = session()
    const chosen = await ctx.presetRouter.routeForPrompt({
      session: sess, content: [{ type: 'text', text: 'make it minimal' }], route: ROUTE,
    })
    expect(chosen).toBe('minimal')
    expect(llm.calls).toHaveLength(1)
    const options = llm.calls[0]!
    expect(options.provider).toBe('test')
    expect(options.model).toBe('test-model')
    expect(options.purpose).toBe('preset-route')
    expect(options.sessionId).toBe(sess.id)
    expect(options.system).toContain('standard')
    expect(options.system).toContain('minimal')
    const last = sess.events.filter(event => event.type === 'preset-route/llm-request').at(-1)!
    expect(last.data.route).toEqual({ provider: 'test', model: 'test-model' })
    expect(last.data.messages[0]?.content).toEqual([{ type: 'text', text: JSON.stringify({ request: 'make it minimal' }) }])
    expect(last.data.maxTokens).toBe(16)
  })

  it('keeps the default on a DEFAULT, unknown, or garbled answer', async () => {
    for (const answer of ['DEFAULT', 'nope', 'minimal extra']) {
      const { ctx, llm } = await harness(answer)
      expect(await ctx.presetRouter.routeForPrompt({ session: session(), content: TEXT_PROMPT, route: ROUTE })).toBeUndefined()
      expect(llm.calls).toHaveLength(1)
    }
  })

  it('normalizes fence-wrapped prose to the exact id', async () => {
    const { ctx } = await harness('```\nminimal\n```')
    expect(await ctx.presetRouter.routeForPrompt({ session: session(), content: TEXT_PROMPT, route: ROUTE })).toBe('minimal')
  })

  it('prefers the configured provider and model over the fallback route', async () => {
    const llm = fakeLlm('minimal')
    const ctx = new Context()
    ctx.provide('llm', { stream: (options: GenerateOptions) => llm.stream(options) } as never)
    ctx.provide('agentPresets', rosterDouble(['standard', 'minimal']) as never)
    await ctx.plugin(PresetRouter, { ...CONFIG, provider: 'cheap', model: 'cheap-model' })
    await ctx.presetRouter.routeForPrompt({ session: session(), content: TEXT_PROMPT, route: ROUTE })
    expect(llm.calls[0]).toMatchObject({ provider: 'cheap', model: 'cheap-model' })
  })

  it('skips without a roster, a broken roster, or an image-only prompt', async () => {
    const { ctx, llm } = await harness('minimal', ['broken'], ['broken'])
    expect(await ctx.presetRouter.routeForPrompt({ session: session(), content: TEXT_PROMPT, route: ROUTE })).toBeUndefined()
    expect(llm.calls).toHaveLength(0)

    const bare = new Context()
    bare.provide('llm', { stream: (options: GenerateOptions) => fakeLlm('minimal').stream(options) } as never)
    await bare.plugin(PresetRouter, CONFIG)
    expect(await bare.presetRouter.routeForPrompt({ session: session(), content: TEXT_PROMPT, route: ROUTE })).toBeUndefined()

    const image = new Context()
    image.provide('llm', { stream: (options: GenerateOptions) => fakeLlm('minimal').stream(options) } as never)
    image.provide('agentPresets', rosterDouble(['standard', 'minimal']) as never)
    await image.plugin(PresetRouter, CONFIG)
    const imagePart = { type: 'image', mediaType: 'image/png', data: 'AQ==' }
    const sessImage = session('image')
    const chosen = await image.presetRouter.routeForPrompt({
      session: sessImage,
      content: [imagePart],
      route: ROUTE,
    })
    expect(chosen).toBeUndefined()
    expect(sessImage.events.some(event => event.type === 'preset-route/llm-request')).toBe(false)
  })

  it('skips an over-long input without calling the model or logging', async () => {
    const { ctx, llm } = await harness('minimal')
    const sess = session()
    const chosen = await ctx.presetRouter.routeForPrompt({
      session: sess,
      content: [{ type: 'text', text: 'x'.repeat(20000) }],
      route: ROUTE,
    })
    expect(chosen).toBeUndefined()
    expect(llm.calls).toHaveLength(0)
    expect(sess.events.some(event => event.type === 'preset-route/llm-request')).toBe(false)
  })

  it('never rejects: provider failure, timeout, and unexpected tool-call output fall back to default', async () => {
    const { ctx } = await harness('THROW')
    await expect(ctx.presetRouter.routeForPrompt({ session: session(), content: TEXT_PROMPT, route: ROUTE })).resolves.toBeUndefined()
    await ctx.fiber.dispose()

    async function branch(llm: FakeLlm, name: string) {
      const next = new Context()
      next.provide('llm', { stream: (options: GenerateOptions) => llm.stream(options) } as never)
      next.provide('agentPresets', rosterDouble(['standard', 'minimal']) as never)
      const fiber = await next.plugin(PresetRouter, CONFIG)
      const chosen = await next.presetRouter.routeForPrompt({ session: session(name), content: TEXT_PROMPT, route: ROUTE })
      expect(chosen).toBeUndefined()
      await fiber.dispose()
    }

    await branch(finishingLlm({ type: 'finish', reason: { kind: 'aborted', failure: { message: 'PRESET_ROUTE_TIMEOUT', code: 'PRESET_ROUTE_TIMEOUT' } } }), 'timeout')
    await branch(finishingLlm({ type: 'finish', reason: { kind: 'tool-calls' } }), 'tool-calls')
    await branch(finishingLlm({ type: 'finish', reason: { kind: 'error', failure: { message: 'e', code: 'E' } } }), 'error')
  })

  it('classifies through the real agent roster over the shipped fixtures', async () => {
    const llm = fakeLlm('minimal')
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.provide('llm', { stream: (options: GenerateOptions) => llm.stream(options) } as never)
    await ctx.plugin(AgentPresets, {
      default: 'standard',
      roots: [{ path: SYSTEM_ROOT, trust: 'system' }],
      includeUserRoot: false,
    })
    const fiber = await ctx.plugin(PresetRouter, CONFIG)
    const chosen = await ctx.presetRouter.routeForPrompt({ session: session('real'), content: TEXT_PROMPT, route: ROUTE })
    expect(chosen).toBe('minimal')
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
