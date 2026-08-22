/**
 * Image-aware model routing. Routes a step whose request history contains an
 * image to a configured image-capable provider/model, and returns to the
 * session's base route once the image has been served this turn.
 *
 * A text-only model cannot process a history that still carries an image
 * (adapters reject it at dispatch), so routing is presence-based: while any
 * derived message contains an image block, the request stays on the vision
 * route. The image leaves derived history when this plugin redacts it — at the
 * first step of the *next* turn, once the turn that supplied the image has been
 * served by the vision model — so the base route resumes for subsequent turns
 * instead of the vision route dragging on for the whole session.
 *
 * The `agent/request` and `agent/pre-step` listeners are registered on the HOST
 * context, making them the OUTERMOST listeners in their waterfalls, so the
 * `agent/request` listener sees the config `installModelSelection` already
 * applied and gets the final say, and the `agent/pre-step` listener redacts
 * before `deriveMessages()` snapshots the next request.
 *
 * @module @deepseek-ai/dsh-image-router
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { contentHasImage, freezeMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, LlmCallConfig, ToolResultMessage, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The mounted image routing target, exposed so host surfaces (the Web
     * image admission gate) can admit pasted images when a vision route
     * exists even though the session's selected model is text-only.
     */
    'image-router'?: ImageRoutingTarget
  }
}

export const name = 'image-router'
export const inject = ['llm']

/** Deployment routing target for image-bearing steps. */
export interface Config {
  /** Registered provider route owning the image-capable model. */
  imageProvider: string
  /** Provider-owned model id that declares image input. */
  imageModel: string
}

/** Host-visible routing target, consumed by image admission gates. */
export interface ImageRoutingTarget {
  /** Provider route owning the vision model. */
  provider: string
  /** Model id that declares image input. */
  model: string
}

/**
 * Text that replaces a redacted image block in derived history. The base
 * (text-only) model cannot carry the image itself; this marker preserves the
 * block's position without leaking bytes. The vision model's description of the
 * image is already the adjacent assistant message.
 */
const IMAGE_PLACEHOLDER = '[image]'

/** Strip a config's reasoning effort so the target route re-resolves its own default. */
function withoutEffort(config: LlmCallConfig): LlmCallConfig {
  const { reasoningEffort: _inherited, ...rest } = config
  return rest
}

/**
 * Replace every image block (at any nesting depth) with the text placeholder,
 * preserving the position of all other blocks verbatim.
 * @param blocks - model content to scrub of image blocks.
 * @returns a copy of `blocks` with images replaced by text.
 */
function redactImages(blocks: readonly ContentBlock[]): ContentBlock[] {
  const scrubbed: ContentBlock[] = []
  for (const block of blocks) {
    if (block.type === 'image') {
      scrubbed.push({ type: 'text', text: IMAGE_PLACEHOLDER })
      continue
    }
    if (block.type === 'tool-result' && contentHasImage(block.content)) {
      scrubbed.push({ ...block, content: redactImages(block.content) })
      continue
    }
    scrubbed.push(block)
  }
  return scrubbed
}

/**
 * Durably shadow every image-bearing surface node with an image-free copy,
 * via the session's model-only surface replacement. The human transcript keeps
 * the original; only derived (model-visible) history drops the image.
 * @param session - session whose current surface is scrubbed of images.
 */
function redactImagesFromHistory(session: Session): void {
  for (const seq of [...session.surface.nodes]) {
    const event = session.events[seq]
    if (event?.type === 'user/message' && contentHasImage(event.data.content)) {
      const message = freezeMessage<UserMessage>({
        ...event.data,
        content: redactImages(event.data.content),
      })
      session.append('user/message', message, {
        surfaceOp: { op: 'replace', start: seq, end: seq },
        sourceEventSeqs: [seq],
      })
      continue
    }
    if (event?.type === 'tool/result' && contentHasImage(event.data.message.content)) {
      const [result] = event.data.message.content
      const message = freezeMessage<ToolResultMessage>({
        ...event.data.message,
        content: [{ ...result, content: redactImages(result.content) }] as [typeof result],
      })
      session.append('tool/result', { ...event.data, message }, {
        surfaceOp: { op: 'replace', start: seq, end: seq },
        sourceEventSeqs: [seq],
      })
    }
  }
}

export function apply(ctx: Context, config: Config): void {
  const { imageProvider, imageModel } = config
  if (imageProvider === '' || imageModel === '') {
    throw new Error('image-router: imageProvider and imageModel must be non-empty strings')
  }

  const target: ImageRoutingTarget = { provider: imageProvider, model: imageModel }
  ctx.provide('image-router', target)

  // Before a fresh turn's first request, drop images served by a prior turn so
  // the base text route can serve this turn. A turn whose own claimed input
  // still carries an image keeps it (the vision route must see it this turn).
  ctx.on('agent/pre-step', ({ agent, messages, step }, next) => {
    if (step === 1 && !messages.some(message => contentHasImage(message.content))) {
      redactImagesFromHistory(agent.session)
    }
    return next()
  })

  ctx.on('agent/request', async ({ agent, signal }, next) => {
    const applied = await next()
    const hasImage = agent.session.deriveMessages().some(message => contentHasImage(message.content))

    if (!hasImage) {
      // Respect manual or base selections; only unwind our own vision routing.
      if (applied.provider !== imageProvider || applied.model !== imageModel) return applied
      const { provider, model } = agent.options
      if (provider === undefined || model === undefined || provider === '' || model === '') return applied
      return { ...withoutEffort(applied), provider, model }
    }

    if (applied.provider === imageProvider && applied.model === imageModel) return applied

    const info = await ctx.llm.resolveModelInfo(imageProvider, imageModel, signal)
    if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
      throw new Error(
        `image-router: model "${imageModel}" (${imageProvider}) does not declare image input; configure an image-capable route`,
      )
    }

    return { ...withoutEffort(applied), provider: imageProvider, model: imageModel }
  })
}
