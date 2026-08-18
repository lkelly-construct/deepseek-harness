/**
 * Model-facing `render_app_url` tool producing a sandboxed live-app preview card.
 * The tool is a pure pass-through view producer: the model supplies a localhost URL
 * (and optional sandbox hints), and `presentResult` returns the `app-preview` card
 * that a capable GUI renders client-side as a sandboxed iframe with `src` set to
 * the URL. No rendering or iframe concern lives here — that is the client card's
 * job. Named exports preserve loader injection metadata.
 * @module @deepseek-ai/dsh-tool-app-preview
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolResultView } from '@deepseek-ai/dsh-tools'

export const name = 'tool-app-preview'
export const inject = ['tools']

/**
 * The canonical view data returned by `execute` and projected onto
 * `result.meta` for replay: the running app URL and optional width and sandbox
 * directives that narrow the client iframe.
 */
export interface RenderAppUrlView {
  /** The localhost URL to render as the iframe src. Must be http://localhost:* or http://127.0.0.1:*. */
  url: string
  /** Preferred viewport width in pixels; absent uses the container width. */
  width?: number
  /** Sandbox directives for the preview iframe; absent defaults to `allow-scripts allow-same-origin`. */
  sandbox?: string
}

/**
 * Drop undefined optional fields so the canonical value omits them entirely
 * (a plain serializable pass-through view).
 * @param url - the model-supplied localhost URL.
 * @param width - optional viewport width hint, or undefined to omit.
 * @param sandbox - optional sandbox directive string, or undefined to omit.
 * @returns the canonical {@link RenderAppUrlView}.
 */
function toView(url: string, width: number | undefined, sandbox: string | undefined): RenderAppUrlView {
  return {
    url,
    ...(width !== undefined ? { width } : {}),
    ...(sandbox !== undefined ? { sandbox } : {}),
  }
}

/**
 * Build the `render_app_url` tool definition. Exported separately from `apply`
 * so tests assert the presenters and view pass-through directly without
 * composing a registry or loader.
 * @returns the registry-ready tool definition.
 */
export function defineRenderAppUrlTool(): ToolDefinition {
  return defineTool({
    name: 'render_app_url',
    description: 'Render a running app preview card from a localhost URL. '
      + 'Start the dev server first (via bash), then pass the `http://localhost:<port>` URL '
      + 'here to surface a sandboxed iframe preview in the GUI. `width` hints the viewport '
      + 'width and `sandbox` narrows the iframe directives (absent means '
      + '`allow-scripts allow-same-origin`). Only accepts localhost URLs.',
    parameters: {
      url: {
        type: 'string',
        required: true,
        description: 'The localhost URL to render in the sandboxed preview iframe. Must be http://localhost:<port> or http://127.0.0.1:<port>.',
      },
      title: {
        type: 'string',
        description: 'Optional replacement title for the rendered preview card.',
      },
      width: {
        type: 'integer',
        description: 'Preferred viewport width in pixels for the preview iframe.',
      },
      sandbox: {
        type: 'string',
        description: 'Sandbox directives for the preview iframe; absent defaults to `allow-scripts allow-same-origin`.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          width: { type: 'integer' },
          sandbox: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered ${value.url} as a live app preview card.`,
      }],
      // Project the view onto result.meta so presentResult can rebuild the card
      // identically on a session-log replay (the canonical value itself is not
      // persisted for top-level calls).
      presentationMeta: (_args, value) => ({ ...value }),
    },
    execute: args => Promise.resolve(toView(args.url, args.width, args.sandbox)),
    presentResult: (_args, result): ToolResultView => {
      const view = result.meta as unknown as RenderAppUrlView | undefined
      if (view === undefined || typeof view.url !== 'string') {
        // Replay should always carry the projected meta; treat a missing or
        // structurally invalid view as a generic fallback rather than crash a
        // presentation pass.
        return { card: 'generic', content: result.content }
      }
      return {
        card: 'app-preview',
        url: view.url,
        ...(view.width !== undefined ? { width: view.width } : {}),
        ...(view.sandbox !== undefined ? { sandbox: view.sandbox } : {}),
      }
    },
  })
}

/**
 * Register the `render_app_url` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineRenderAppUrlTool())
}
