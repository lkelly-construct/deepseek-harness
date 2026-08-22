/**
 * Inlined text-file attachment admission: a `text-file` prompt part becomes a
 * durable `text-file` content block without touching the attachment store, is
 * validated against the deployment media allow-list and byte cap, and never
 * triggers the bare-image describe branch (that branch is image-only).
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy, DEFAULT_MAX_PDF_BYTES } from '../src/api-proxy.ts'
import { sessionPromptRequestSchema } from '../src/api/sessions.schema.ts'
import { minimalPdf } from './pdf-fixture.ts'

const helloPdfBase64 = Buffer.from(minimalPdf('Hello World')).toString('base64')

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`files-${String(nextRpc++)}`), payload }
}

class NoopAdapter extends LlmAdapter {
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: provider }
  }

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Admission tests never enter provider streaming.
  }
}

async function harness(): Promise<{ ctx: Context; agent: Agent; sessionId: SessionId }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  ctx.llm.registerAdapter(['deepseek-official'], new NoopAdapter())
  const session = ctx.sessions.create()
  const agent = {
    id: session.id,
    session,
    status: 'running',
    ctx,
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  ctx.agents.register(agent)
  return { ctx, agent, sessionId: session.id }
}

/** Minimal image admission seam so the image+file case can persist images. */
function installAttachments(ctx: Context): { saveImage: ReturnType<typeof vi.fn> } {
  const saveImage = vi.fn((input: { data: Uint8Array; mediaType: 'image/png'; name?: string }) => Promise.resolve({
    attachmentId: `att-${String(input.data[0])}`,
    mediaType: input.mediaType,
    bytes: input.data.byteLength,
    width: 1,
    height: 1,
    ...input.name === undefined ? {} : { name: input.name },
  }))
  const attachments = {
    imageLimits: {
      maxImageBytes: 4,
      maxImagesPerMessage: 2,
      maxMessageImageBytes: 4,
      maxImagePixels: 4,
      mediaTypes: ['image/png'],
    },
    validateImage: vi.fn((_input: { data: Uint8Array }) => Promise.resolve()),
    saveImage,
  }
  ctx.provide('attachments', {
    ...attachments,
    saveImages(inputs: readonly Parameters<typeof saveImage>[0][]) {
      return AttachmentStore.prototype.saveImages.call(attachments, inputs)
    },
  } as never)
  return { saveImage }
}

function followupContent(agent: Agent): UserMessage {
  const call = (agent as unknown as { followup?: ReturnType<typeof vi.fn> }).followup
  if (call === undefined) throw new Error('agent.followup was not installed')
  return call.mock.calls[0]?.[0] as UserMessage
}

describe('Web text-file attachment admission', () => {
  it('admits a text-file part as a durable text-file block without the attachment store', async () => {
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'text-file' as const, name: 'main.py', mediaType: 'text/x-python', text: 'print("hi")' },
      ],
    }))
    expect(result.result.ok).toBe(true)
    expect(followupContent(agent).content).toEqual([
      { type: 'text-file', name: 'main.py', mediaType: 'text/x-python', text: 'print("hi")' },
    ])
    await ctx.fiber.dispose()
  })

  it('keeps a text-file-only message off the bare-image describe branch', async () => {
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'text-file' as const, name: 'notes.md', mediaType: 'text/markdown', text: '# notes' },
      ],
    }))
    // No "Describe this image in detail." is prepended: a text file is content.
    expect(followupContent(agent).content).toEqual([
      { type: 'text-file', name: 'notes.md', mediaType: 'text/markdown', text: '# notes' },
    ])
    await ctx.fiber.dispose()
  })

  it('admits an image and a text file together, still persisting the image', async () => {
    const { ctx, agent, sessionId } = await harness()
    const { saveImage } = installAttachments(ctx)
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==', name: 'shot.png' },
        { type: 'text' as const, text: 'compare' },
        { type: 'text-file' as const, name: 'data.csv', mediaType: 'text/csv', text: 'a,b\n1,2' },
      ],
    }))
    expect(result.result.ok).toBe(true)
    expect(saveImage).toHaveBeenCalledTimes(1)
    expect(followupContent(agent).content).toEqual([
      { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'shot.png' } },
      { type: 'text', text: 'compare' },
      { type: 'text-file', name: 'data.csv', mediaType: 'text/csv', text: 'a,b\n1,2' },
    ])
    await ctx.fiber.dispose()
  })

  it('rejects an unknown text-file media type', async () => {
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'text-file' as const, name: 'x.svg', mediaType: 'image/svg+xml', text: '<svg/>' },
      ],
    }))
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'UNSUPPORTED_FILE_TYPE' } },
    })
    expect(followup).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('rejects inlined text over the per-file byte cap', async () => {
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'text-file' as const, name: 'big.txt', mediaType: 'text/plain', text: 'x'.repeat(512_001) },
      ],
    }))
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'FILE_TOO_LARGE' } },
    })
    expect(followup).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('rejects a batch over the per-message file cap', async () => {
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: Array.from({ length: 11 }, (_, index) => ({
        type: 'text-file' as const,
        name: `f${index}.txt`,
        mediaType: 'text/plain',
        text: 'x',
      })),
    }))
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'TOO_MANY_FILES' } },
    })
    expect(followup).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})

describe('Web PDF attachment admission', () => {
  it('extracts a pdf file part into a durable text-file block', async () => {
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'file' as const, name: 'hello.pdf', mediaType: 'application/pdf', data: helloPdfBase64 },
      ],
    }))
    expect(result.result.ok).toBe(true)
    expect(followupContent(agent).content).toEqual([
      { type: 'text-file', name: 'hello.pdf', mediaType: 'application/pdf', text: 'Hello World' },
    ])
    await ctx.fiber.dispose()
  })

  it('keeps a pdf-only message off the bare-image describe branch', async () => {
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'file' as const, name: 'hello.pdf', mediaType: 'application/pdf', data: helloPdfBase64 },
      ],
    }))
    // No "Describe this image in detail." is prepended for a non-image-only message.
    expect(followupContent(agent).content).toEqual([
      { type: 'text-file', name: 'hello.pdf', mediaType: 'application/pdf', text: 'Hello World' },
    ])
    await ctx.fiber.dispose()
  })

  it('admits an image and a pdf together, still persisting the image', async () => {
    const { ctx, agent, sessionId } = await harness()
    const { saveImage } = installAttachments(ctx)
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==', name: 'shot.png' },
        { type: 'text' as const, text: 'compare' },
        { type: 'file' as const, name: 'hello.pdf', mediaType: 'application/pdf', data: helloPdfBase64 },
      ],
    }))
    expect(result.result.ok).toBe(true)
    expect(saveImage).toHaveBeenCalledTimes(1)
    expect(followupContent(agent).content).toEqual([
      { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'shot.png' } },
      { type: 'text', text: 'compare' },
      { type: 'text-file', name: 'hello.pdf', mediaType: 'application/pdf', text: 'Hello World' },
    ])
    await ctx.fiber.dispose()
  })

  it('rejects an unsupported media type on a file part', async () => {
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'file' as const, name: 'x.zip', mediaType: 'application/zip', data: helloPdfBase64 },
      ],
    }))
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'UNSUPPORTED_FILE_TYPE' } },
    })
    expect(followup).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('rejects a pdf over the per-file byte cap', async () => {
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const oversizedBase64 = Buffer.alloc(DEFAULT_MAX_PDF_BYTES + 1).toString('base64')
    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'file' as const, name: 'big.pdf', mediaType: 'application/pdf', data: oversizedBase64 },
      ],
    }))
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'FILE_TOO_LARGE' } },
    })
    expect(followup).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('rejects a pdf batch over the per-message file cap', async () => {
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: Array.from({ length: 6 }, (_, index) => ({
        type: 'file' as const,
        name: `f${index}.pdf`,
        mediaType: 'application/pdf',
        data: helloPdfBase64,
      })),
    }))
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'TOO_MANY_FILES' } },
    })
    expect(followup).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('rejects a file part whose data is not canonical base64', async () => {
    const { ctx, agent, sessionId } = await harness()
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'file' as const, name: 'bad.pdf', mediaType: 'application/pdf', data: '%%%not base64%%%' },
      ],
    }))
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'INVALID_PDF' } },
    })
    expect(followup).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})

describe('text-file prompt wire schema', () => {
  it('rejects an empty file name', () => {
    const parsed = sessionPromptRequestSchema.safeParse({
      sessionId: 's1',
      mode: 'queue',
      content: [{ type: 'text-file', name: '', mediaType: 'text/plain', text: 'x' }],
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts a well-formed text-file part', () => {
    const parsed = sessionPromptRequestSchema.safeParse({
      sessionId: 's1',
      mode: 'queue',
      content: [{ type: 'text-file', name: 'a.json', mediaType: 'application/json', text: '{}' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts a well-formed file part', () => {
    const parsed = sessionPromptRequestSchema.safeParse({
      sessionId: 's1',
      mode: 'queue',
      content: [{ type: 'file', name: 'a.pdf', mediaType: 'application/pdf', data: 'AAAA' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a file part with a non-pdf media type', () => {
    const parsed = sessionPromptRequestSchema.safeParse({
      sessionId: 's1',
      mode: 'queue',
      content: [{ type: 'file', name: 'a.zip', mediaType: 'application/zip', data: 'AAAA' }],
    })
    expect(parsed.success).toBe(false)
  })
})
