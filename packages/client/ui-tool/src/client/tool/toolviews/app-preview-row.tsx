// App-preview toolview registrant: the keyed toolview hole for the
// `render_app_url` tool (and any other tool that produces `card:'app-preview'`
// results). The row composes the shared ToolRow (chrome, running sweep,
// whole-row expand) and feeds it the appPreview card material so it renders
// through AppPreviewBlock in the collapsed-by-default expanded body — the same
// unified interaction every other card row has. Until the call settles there is
// no app-preview card (the tool keeps a generic pending view), so a running row
// is the summary line alone.

import type { Context } from '@deepseek-ai/cordis'
import { IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { appPreviewCardModel } from '../models/app-preview-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Full row props: the toolview runtime share plus the standard locale seat. */
type AppPreviewRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * App-preview row: the generic icon + App Preview · {summary} in the shared ToolRow
 * chrome, with the completed live-app preview card as the row's collapsed-by-default
 * card body.
 */
export function AppPreviewRow({ toolName, block, inspect, t }: AppPreviewRowProps) {
  const model = toolRowModel(toolName, block)
  const appPreview = appPreviewCardModel(block)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconBrowseOutline16 size={14} />}
      title="App Preview"
      summary={model.summary}
      body={null}
      output={model.output}
      errorSummary={model.errorSummary}
      appPreview={appPreview}
      state={model.state}
      inspect={inspect}
    />
  )
}

/**
 * The app-preview row follows the atomic Tool-view declaration across
 * activation and reload. Registered under `render_app_url` — tool plugins that
 * register a different name should add their own keyed entry.
 */
export const appPreviewToolview = {
  name: 'app-preview-toolview',
  inject: ['slots'],
  /**
   * Register the app-preview row under every tool name that produces an
   * app-preview card.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'render_app_url', locale: NS }, AppPreviewRow)
    })
  },
}
