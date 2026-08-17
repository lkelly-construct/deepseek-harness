// @vitest-environment jsdom
// The html-preview render intent on the web side: the pure htmlPreviewCardModel
// derivation over resultView, and the conversation render sites that consume
// it — the keyed HtmlPreviewRow (registered under render_html), the
// GenericToolCard render-site fallback, and the details panel's Output section.
// Mirrors web-card.client.spec.tsx: model derivation + null arms, the chat
// row's collapsed-by-default ToolRow card, the panel arm, and the keyed
// registration. The iframe stays sandboxed: the primitive defaults sandbox to
// allow-scripts (never allow-same-origin) and renders through srcdoc.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type {
  RunningToolCall, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { htmlPreviewCardModel } from '../src/client/tool/models/html-preview-card-model.ts'
import { GenericToolCard } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { HtmlPreviewRow, htmlPreviewToolview } from '../src/client/tool/toolviews/html-preview-row.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

/** Locale seat for the card render sites (GenericToolCard, HtmlPreviewRow). */
const t = makeTranslate(zh, commonZh)

const HTML_ARGS = '{"html":"<h1>Hi</h1>"}'
const SAMPLE_HTML = '<h1>Hi</h1>'

/** An html-preview result view; overrides tune the html / width / sandbox. */
const resultHtml = (over?: Partial<Extract<ToolResultView, { card: 'html-preview' }>>): ToolResultView => ({
  card: 'html-preview', html: SAMPLE_HTML, ...over,
})

const runningHtml = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'render_html', argsRaw: HTML_ARGS,
  turn: 1, step: 1, time: 1_000, callView: { card: 'generic', title: 'Preview' }, subCalls: [], ...over,
})

const settledHtml = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'render_html', argsRaw: HTML_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: '<h1>Hi</h1>' }], isError: false,
  callView: { card: 'generic', title: 'Preview' }, resultView: resultHtml(), subCalls: [], ...over,
})

describe('htmlPreviewCardModel', () => {
  it('derives a preview card from the result view', () => {
    expect(htmlPreviewCardModel(settledHtml())).toEqual({ html: SAMPLE_HTML, width: undefined, sandbox: undefined })
  })

  it('carries the declared width and sandbox when the tool supplies them', () => {
    expect(htmlPreviewCardModel(settledHtml({ resultView: resultHtml({ width: 640, sandbox: 'none' }) })))
      .toEqual({ html: SAMPLE_HTML, width: 640, sandbox: 'none' })
  })

  it('returns null for a running call, since the html-preview card is result-only', () => {
    expect(htmlPreviewCardModel(runningHtml())).toBeNull()
  })

  it('returns null for a settled call whose result view is not an html-preview card', () => {
    expect(htmlPreviewCardModel(settledHtml({ resultView: null }))).toBeNull()
    expect(htmlPreviewCardModel(settledHtml({ resultView: { card: 'generic' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'artifact', kind: 'chart' } as unknown as ToolResultView
    expect(htmlPreviewCardModel(settledHtml({ resultView: future }))).toBeNull()
  })
})

describe('HtmlPreviewRow', () => {
  const ownerProps = (block: RunningToolCall | ToolResultNode): ToolCallOwnerProps => ({
    callId: block.callId, toolName: 'render_html', block, openFile: vi.fn(), inspect: vi.fn(),
  })
  // The row renders through the shared ToolRow's props plus the locale seat.
  const rowProps = (block: RunningToolCall | ToolResultNode): Parameters<typeof HtmlPreviewRow>[0] =>
    ({ ...ownerProps(block), t } as unknown as Parameters<typeof HtmlPreviewRow>[0])

  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('collapses to the summary row, expanding to the sandboxed preview iframe', () => {
    const view = render(<HtmlPreviewRow {...rowProps(settledHtml())} />)
    // Collapsed: the summary row alone, no iframe in the DOM.
    expect(view.getByText('Preview')).toBeTruthy()
    expect(view.container.querySelector('iframe')).toBeNull()
    toggleRow(view)
    const iframe = view.container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute('srcdoc')).toBe(SAMPLE_HTML)
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('renders the summary line alone while the call is running', () => {
    const view = render(<HtmlPreviewRow {...rowProps(runningHtml())} />)
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(view.getByText('Preview')).toBeTruthy()
  })
})

describe('chat row html-preview body (GenericToolCard fallback)', () => {
  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('expands to the sandboxed preview from the generic fallback path', () => {
    const view = render(<GenericToolCard {...{
      callId: 'c1', toolName: 'render_html', block: settledHtml(), openFile: vi.fn(), t,
    }} />)
    expect(view.container.querySelector('iframe')).toBeNull()
    toggleRow(view)
    const iframe = view.container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute('srcdoc')).toBe(SAMPLE_HTML)
  })
})

/** The registered-key set is pinned by the apply-level surface and HMR tests of the web profile; here the constant export is exercised. */
describe('htmlPreviewToolview registration', () => {
  it('is exported as the cordis plugin contract', () => {
    expect(htmlPreviewToolview.name).toBe('html-preview-toolview')
    expect(htmlPreviewToolview.inject).toEqual(['slots'])
    expect(typeof htmlPreviewToolview.apply).toBe('function')
  })
})