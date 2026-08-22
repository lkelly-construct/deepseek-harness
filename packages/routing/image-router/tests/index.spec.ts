/**
 * The image-router function plugin: presence-based routing of image-bearing
 * steps to a configured vision route, then redaction of served images from the
 * derived history at the next turn's first step so the base (text-only) route
 * resumes instead of dragging on for the whole session.
 *
 * Listener registration and event emission follow the model-selection pattern:
 * the plugin's `apply` mounts its listeners on a hand-built Cordis `Context`,
 * and the behaviors are exercised with a fake agent through `agentEvents(...)`
 * on that same context.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import {
  ReasoningEffortId,
  CallId,
  contentHasImage,
  createMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, LlmCallConfig, Message, UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../src/index.ts'

const SIGNAL = new AbortController().signal
const IMAGE_PLACEHOLDER = '[image]'

/** A minimal valid image attachment reference rooted in the attachment branding. */
function imageRef(): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${'0'.repeat(64)}`),
    mediaType: 'image/png',
    bytes: 1,
    width: 1,
    height: 1,
  }
}

function imageBlock(): ContentBlock {
  return { type: 'image', attachment: imageRef() }
}

/** Flatten every text block in the given messages, recursing into tool-result content. */
function imageText(messages: readonly Message[]): string {
  const collect = (blocks: readonly ContentBlock[]): string =>
    blocks.map(block =>
      block.type === 'text' ? block.text
        : block.type === 'tool-result' ? collect(block.content)
          : '').join('\n')
  return messages.map(message => collect(message.content)).join('\n')
}

/** The fake `llm` service the plugin's inject map resolves at runtime. */
interface FakeLlm {
  resolveModelInfo: (
    provider: string,
    model: string,
    signal?: AbortSignal,
  ) => Promise<{ provider: string; id: string; name: string; inputModalities?: readonly string[] }>
}

function visionLlm(): FakeLlm {
  return {
    async resolveModelInfo(provider, model) {
      return { provider, id: model, name: model, inputModalities: ['text', 'image'] }
    },
  }
}

function textLlm(): FakeLlm {
  return {
    async resolveModelInfo(provider, model) {
      return { provider, id: model, name: model, inputModalities: ['text'] }
    },
  }
}

/** Mount the plugin on a fresh context with a fake `llm` service. */
function mount(config: Config, llm: FakeLlm): Context {
  const ctx = new Context()
  ctx.provide('llm' as never, llm)
  apply(ctx, config)
  return ctx
}

function agent(session: Session, options: { provider?: string; model?: string } = {}): Agent {
  return { session, options } as unknown as Agent
}

function textOnlyMessage(): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: 'proceed' }],
    source: { kind: 'user' },
  })
}

/**
 * A session whose first turn served one pasted `user/message` image and one
 * `tool/result` image, followed by an open, image-free next turn.
 */
function imageServedSession(): Session {
  const session = Session.create(SessionId('image-served'))
  const callId = CallId('read-image-call')
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'describe this' }, imageBlock()],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: callId, name: 'read_image', arguments: '{}' }],
      source: { kind: 'model', provider: 'vision-provider', model: 'vision-model' },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step: 1, callId, name: 'read_image', arguments: '{}' })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId, content: [imageBlock()], isError: false }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  return session
}

/** A session whose first turn carried only a user/message image. */
function imageUserSession(): Session {
  const session = Session.create(SessionId('image-user'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [imageBlock()],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  return session
}

/** A session with no Model-visible image blocks on the surface. */
function imageFreeSession(id: string): Session {
  return Session.create(SessionId(id))
}

const CONFIG: Config = { imageProvider: 'vision-provider', imageModel: 'vision-model' }
const VISION = visionLlm()

describe('image-router config validation', () => {
  it.each([
    ['imageProvider', { imageProvider: '', imageModel: CONFIG.imageModel }],
    ['imageModel', { imageProvider: CONFIG.imageProvider, imageModel: '' }],
  ])('throws when %s is empty', (_field, config) => {
    const ctx = new Context()
    expect(() => apply(ctx, config as Config)).toThrow(/non-empty/)
  })

  it('provides the image routing target once mounted', () => {
    const ctx = mount(CONFIG, VISION)
    expect(ctx['image-router']).toEqual({ provider: 'vision-provider', model: 'vision-model' })
  })
})

describe('image-router agent/request routing', () => {
  it('routes an image-bearing session to the vision route', async () => {
    const session = imageUserSession()
    const resolveModelInfo = vi.fn(async (provider: string, model: string) =>
      ({ provider, id: model, name: model, inputModalities: ['text', 'image'] }))
    const ctx = mount(CONFIG, { resolveModelInfo })
    const owner = agent(session)

    const result = await agentEvents(ctx, owner).waterfall(
      'agent/request', { turn: 2, step: 1, signal: SIGNAL },
      () => Promise.resolve({ provider: 'base-provider', model: 'base-model' }),
    )
    expect(result).toEqual({ provider: 'vision-provider', model: 'vision-model' })
    expect(resolveModelInfo).toHaveBeenCalledWith('vision-provider', 'vision-model', SIGNAL)
  })

  it('unwinds to the agent options when no image remains and the applied route is ours', async () => {
    const session = imageFreeSession('no-image-unwind')
    const ctx = mount(CONFIG, VISION)
    const owner = agent(session, { provider: 'base-provider', model: 'base-model' })

    const result = await agentEvents(ctx, owner).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL },
      () => Promise.resolve({
        provider: 'vision-provider', model: 'vision-model', reasoningEffort: ReasoningEffortId('high'),
      }),
    )
    expect(result).toEqual({ provider: 'base-provider', model: 'base-model' })
  })

  it('leaves a non-image manual/base selection untouched', async () => {
    const session = imageFreeSession('manual')
    const ctx = mount(CONFIG, VISION)
    const owner = agent(session)
    const manual: LlmCallConfig = { provider: 'manual-provider', model: 'manual-model', temperature: 0.3 }

    const result = await agentEvents(ctx, owner).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL },
      () => Promise.resolve(manual),
    )
    expect(result).toBe(manual)
  })

  it('leaves the applied config untouched when the router is not applicable', async () => {
    const session = imageFreeSession('not-applicable')
    const ctx = mount(CONFIG, VISION)
    const owner = agent(session)
    const base: LlmCallConfig = { provider: 'base-provider', model: 'base-model' }

    // No image in derived history and the applied route is not ours: the
    // listener must resolve nothing and preserve the base config unchanged.
    const result = await agentEvents(ctx, owner).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL },
      () => Promise.resolve(base),
    )
    expect(result).toEqual(base)
  })

  it('throws when the vision model does not declare image input', async () => {
    const session = imageUserSession()
    const ctx = mount(CONFIG, textLlm())
    const owner = agent(session)

    await expect(agentEvents(ctx, owner).waterfall(
      'agent/request', { turn: 2, step: 1, signal: SIGNAL },
      () => Promise.resolve({ provider: 'base-provider', model: 'base-model' }),
    )).rejects.toThrow(/does not declare image input/)
  })
})

describe('image-router agent/pre-step redaction', () => {
  it('redacts both a served user image and a tool-result image at the next turn step 1', async () => {
    const session = imageServedSession()
    const ctx = mount(CONFIG, VISION)
    const owner = agent(session)
    const noImage: UserMessage[] = [textOnlyMessage()]

    await agentEvents(ctx, owner).waterfall(
      'agent/pre-step', { turn: 2, step: 1, signal: SIGNAL, messages: noImage },
      () => Promise.resolve({ kind: 'enter', messages: noImage }),
    )

    const messages = session.deriveMessages()
    const text = imageText(messages)
    expect(text.split(IMAGE_PLACEHOLDER).length - 1).toBe(2)
    expect(messages.some(message => contentHasImage(message.content))).toBe(false)
  })

  it('keeps a fresh turn whose own claimed input still carries an image', async () => {
    const session = imageUserSession()
    const ctx = mount(CONFIG, VISION)
    const owner = agent(session)
    const stillImage: UserMessage[] = [createUserMessage({
      content: [imageBlock()],
      source: { kind: 'user' },
    })]
    const before = [...session.deriveMessages()]

    await agentEvents(ctx, owner).waterfall(
      'agent/pre-step', { turn: 2, step: 1, signal: SIGNAL, messages: stillImage },
      () => Promise.resolve({ kind: 'enter', messages: stillImage }),
    )
    expect(session.deriveMessages()).toEqual(before)
    expect(session.surface.replaceGeneration).toBe(0)
  })

  it('does not redact on a mid-turn step after the first', async () => {
    const session = imageUserSession()
    const ctx = mount(CONFIG, VISION)
    const owner = agent(session)
    const noImage: UserMessage[] = [textOnlyMessage()]
    const before = [...session.deriveMessages()]

    await agentEvents(ctx, owner).waterfall(
      'agent/pre-step', { turn: 2, step: 2, signal: SIGNAL, messages: noImage },
      () => Promise.resolve({ kind: 'enter', messages: noImage }),
    )
    expect(session.deriveMessages()).toEqual(before)
    expect(session.surface.replaceGeneration).toBe(0)
  })
})
