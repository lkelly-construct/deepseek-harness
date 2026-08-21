/**
 * Image-aware model routing. Routes a step whose request history contains an
 * image to a configured image-capable provider/model, and returns to the
 * session's base route once no image remains in history.
 *
 * A text-only model cannot process a history that still carries an image
 * (adapters reject it at dispatch), so routing is presence-based rather than
 * "new image" based: while any derived message contains an image block, the
 * request stays on the vision route.
 *
 * The `agent/request` listener is registered on the HOST context, making it
 * the OUTERMOST listener in the waterfall, so it sees the config that
 * `installModelSelection` already applied and gets the final say.
 *
 * @module @deepseek-ai/dsh-image-router
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { contentHasImage } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'

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

/** Strip a config's reasoning effort so the target route re-resolves its own default. */
function withoutEffort(config: LlmCallConfig): LlmCallConfig {
  const { reasoningEffort: _inherited, ...rest } = config
  return rest
}

export function apply(ctx: Context, config: Config): void {
  const { imageProvider, imageModel } = config
  if (imageProvider === '' || imageModel === '') {
    throw new Error('image-router: imageProvider and imageModel must be non-empty strings')
  }

  const target: ImageRoutingTarget = { provider: imageProvider, model: imageModel }
  ctx.provide('image-router', target)

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
