/**
 * Pure derivation of the html-preview-card props from a frozen call slice: the
 * `card:'html-preview'` render intent arrives on the snapshot as `resultView`,
 * and this is the one place that turns it into what {@link HtmlPreviewBlock}
 * draws. Both conversation render sites (the chat tool row's expanded body and
 * the details panel's Output section) call this, so the preview they show is
 * derived once.
 *
 * The html-preview card is result-only by contract: tools keep a generic pending
 * call view, so there is nothing to derive while the call is still running and
 * a running call always takes the generic path.
 * @module
 */
import type { HtmlPreviewBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from './tool-call-model.ts'

/**
 * Derive the html-preview-card props for a tool call, or null when this call is
 * not an html-preview card and belongs on the generic path.
 *
 * Cases producing null, all of them the documented generic-card default:
 *
 * - A running call (no `resultView` yet): the html-preview tool keeps a generic
 *   pending card, so nothing shaped exists until the call settles.
 * - A settled call whose result view is not an html-preview card — including a
 *   `card` value this UI version does not know, which arrives over the wire and
 *   so cannot be trusted to be one of the compiled variants, and a generic
 *   result view.
 * @param block - RunningToolCall or ToolResultNode off the snapshot caches.
 * @returns the html-preview-card props, or null for the generic path.
 */
export function htmlPreviewCardModel(block: ToolCallBlock): HtmlPreviewBlockProps | null {
  // Running calls have no result view; the html-preview card is result-only.
  if (!('kind' in block)) return null
  const result = block.resultView
  if (result?.card !== 'html-preview') return null
  return {
    html: result.html,
    width: result.width,
    sandbox: result.sandbox,
  }
}
