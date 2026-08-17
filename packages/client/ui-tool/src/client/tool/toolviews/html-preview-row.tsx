// Html-preview toolview registrant: the keyed toolview hole for the
// `render_html` tool (and any other tool that produces `card:'html-preview'`
// results). The row composes the shared ToolRow (chrome, running sweep,
// whole-row expand) and feeds it the htmlPreview card material so it renders
// through HtmlPreviewBlock in the collapsed-by-default expanded body — the same
// unified interaction every other card row has. Until the call settles there is
// no html-preview card (the tool keeps a generic pending view), so a running row
// is the summary line alone.

import type { Context } from '@deepseek-ai/cordis'
import { IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { htmlPreviewCardModel } from '../models/html-preview-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Full row props: the toolview runtime share plus the standard locale seat. */
type HtmlPreviewRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * Html-preview row: the generic icon + Preview · {summary} in the shared ToolRow
 * chrome, with the completed HTML preview card as the row's collapsed-by-default
 * card body.
 */
export function HtmlPreviewRow({ toolName, block, inspect, t }: HtmlPreviewRowProps) {
  const model = toolRowModel(toolName, block)
  const htmlPreview = htmlPreviewCardModel(block)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconSparkle16 size={14} />}
      title="Preview"
      summary={model.summary}
      body={null}
      output={model.output}
      errorSummary={model.errorSummary}
      htmlPreview={htmlPreview}
      state={model.state}
      inspect={inspect}
    />
  )
}

/**
 * The html-preview row follows the atomic Tool-view declaration across
 * activation and reload. Registered under `render_html` — tool plugins that
 * register a different name should add their own keyed entry.
 */
export const htmlPreviewToolview = {
  name: 'html-preview-toolview',
  inject: ['slots'],
  /**
   * Register the html-preview row under every tool name that produces an
   * html-preview card.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'render_html', locale: NS }, HtmlPreviewRow)
    })
  },
}
