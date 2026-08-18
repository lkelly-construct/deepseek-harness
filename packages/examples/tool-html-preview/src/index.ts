/**
 * Model-facing `render_html` tool producing a sandboxed HTML preview card.
 * The tool is a pure pass-through view producer: it copies the model's HTML
 * source (plus optional width and sandbox hints) into the canonical view value,
 * and `presentResult` returns the `html-preview` card that a capable GUI
 * renders client-side. No rendering or iframe concern lives here — that is the
 * client card's job. Named exports preserve loader injection metadata.
 * @module @deepseek-ai/dsh-tool-html-preview
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolResultView } from '@deepseek-ai/dsh-tools'

export const name = 'tool-html-preview'
export const inject = ['tools']

/**
 * The canonical view data returned by `execute` and projected onto
 * `result.meta` for replay: the complete HTML source and the optional viewport
 * width and sandbox directives that narrow the client iframe.
 */
export interface RenderHtmlView {
  /** The complete HTML source to render inside the sandboxed preview. */
  html: string
  /** Preferred viewport width in pixels; absent uses the container width. */
  width?: number
  /** Sandbox directives for the preview iframe; absent defaults to `allow-scripts`. */
  sandbox?: string
}

/**
 * Drop undefined optional fields so the canonical value omits them entirely
 * (a plain serializable pass-through view).
 * @param html - the model-supplied HTML source.
 * @param width - optional viewport width hint, or undefined to omit.
 * @param sandbox - optional sandbox directive string, or undefined to omit.
 * @returns the canonical {@link RenderHtmlView}.
 */
function toView(html: string, width: number | undefined, sandbox: string | undefined): RenderHtmlView {
  return {
    html,
    ...(width !== undefined ? { width } : {}),
    ...(sandbox !== undefined ? { sandbox } : {}),
  }
}

/**
 * Build the `render_html` tool definition. Exported separately from `apply`
 * so tests assert the presenters and view pass-through directly without
 * composing a registry or loader.
 * @returns the registry-ready tool definition.
 */
export function defineRenderHtmlTool(): ToolDefinition {
  return defineTool({
    name: 'render_html',
    description: 'Render an HTML preview card. The `<html>` argument is the complete '
      + 'source the GUI renders client-side in a sandboxed iframe; `width` hints the '
      + 'viewport width and `sandbox` narrows the iframe directives (absent means '
      + '`allow-scripts`). The rendered preview is not a model-visible result; the tool '
      + 'is a pass-through that merely carries the HTML to the card.',
    parameters: {
      html: {
        type: 'string',
        required: true,
        description: 'The complete HTML source to render in the sandboxed preview iframe.',
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
        description: 'Sandbox directives for the preview iframe; absent defaults to `allow-scripts`.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          html: { type: 'string', required: true },
          width: { type: 'integer' },
          sandbox: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered ${value.html.length} bytes of HTML to the preview card.`,
      }],
      // Project the view onto result.meta so presentResult can rebuild the card
      // identically on a session-log replay (the canonical value itself is not
      // persisted for top-level calls).
      presentationMeta: (_args, value) => ({ ...value }),
    },
    execute: args => Promise.resolve(toView(args.html, args.width, args.sandbox)),
    presentResult: (_args, result): ToolResultView => {
      const view = result.meta as unknown as RenderHtmlView | undefined
      if (view === undefined || typeof view.html !== 'string') {
        // Replay should always carry the projected meta; treat a missing or
        // structurally invalid view as a generic fallback rather than crash a
        // presentation pass.
        return { card: 'generic', content: result.content }
      }
      return {
        card: 'html-preview',
        html: view.html,
        ...(view.width !== undefined ? { width: view.width } : {}),
        ...(view.sandbox !== undefined ? { sandbox: view.sandbox } : {}),
      }
    },
  })
}

/**
 * Register the `render_html` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineRenderHtmlTool())
}
