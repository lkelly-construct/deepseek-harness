// @vitest-environment jsdom
// The app-preview render intent on the web side: the pure appPreviewCardModel
// derivation over resultView, and the conversation render sites that consume
// it — the keyed AppPreviewRow (registered under render_app_url), the
// GenericToolCard render-site fallback, and the details panel's Output section.
// Mirrors html-preview-card.client.spec.tsx: model derivation + null arms, the
// chat row's collapsed-by-default ToolRow card, the panel arm, and the keyed
// registration. The iframe loads a real URL (src): the default sandbox is
// allow-scripts allow-same-origin so the running app can load its own assets.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type {
  RunningToolCall, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { appPreviewCardModel } from '../src/client/tool/models/app-preview-card-model.ts'
import { GenericToolCard } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { AppPreviewRow, appPreviewToolview } from '../src/client/tool/toolviews/app-preview-row.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

/** Locale seat for the card render sites (GenericToolCard, AppPreviewRow). */
const t = makeTranslate(zh, commonZh)

const URL_ARGS = '{"url":"http://localhost:5173"}'
const SAMPLE_URL = 'http://localhost:5173'

/** An app-preview result view; overrides tune the url / width / sandbox. */
const resultApp = (over?: Partial<Extract<ToolResultView, { card: 'app-preview' }>>): ToolResultView => ({
  card: 'app-preview', url: SAMPLE_URL, ...over,
})

const runningApp = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'render_app_url', argsRaw: URL_ARGS,
  turn: 1, step: 1, time: 1_000, callView: { card: 'generic', title: 'App Preview' }, subCalls: [], ...over,
})

const settledApp = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'render_app_url', argsRaw: URL_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: SAMPLE_URL }], isError: false,
  callView: { card: 'generic', title: 'App Preview' }, resultView: resultApp(), subCalls: [], ...over,
})

describe('appPreviewCardModel', () => {
  it('derives a preview card from the result view', () => {
    expect(appPreviewCardModel(settledApp())).toEqual({ url: SAMPLE_URL, width: undefined, sandbox: undefined })
  })

  it('carries the declared width and sandbox when the tool supplies them', () => {
    expect(appPreviewCardModel(settledApp({ resultView: resultApp({ width: 640, sandbox: 'none' }) })))
      .toEqual({ url: SAMPLE_URL, width: 640, sandbox: 'none' })
  })

  it('returns null for a running call, since the app-preview card is result-only', () => {
    expect(appPreviewCardModel(runningApp())).toBeNull()
  })

  it('returns null for a settled call whose result view is not an app-preview card', () => {
    expect(appPreviewCardModel(settledApp({ resultView: null }))).toBeNull()
    expect(appPreviewCardModel(settledApp({ resultView: { card: 'generic' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'artifact', kind: 'chart' } as unknown as ToolResultView
    expect(appPreviewCardModel(settledApp({ resultView: future }))).toBeNull()
  })
})

describe('AppPreviewRow', () => {
  const ownerProps = (block: RunningToolCall | ToolResultNode): ToolCallOwnerProps => ({
    callId: block.callId, toolName: 'render_app_url', block, openFile: vi.fn(), inspect: vi.fn(),
  })
  // The row renders through the shared ToolRow's props plus the locale seat.
  const rowProps = (block: RunningToolCall | ToolResultNode): Parameters<typeof AppPreviewRow>[0] =>
    ({ ...ownerProps(block), t } as unknown as Parameters<typeof AppPreviewRow>[0])

  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('collapses to the summary row, expanding to the sandboxed live-app iframe', () => {
    const view = render(<AppPreviewRow {...rowProps(settledApp())} />)
    // Collapsed: the summary row alone, no iframe in the DOM.
    expect(view.getByText('App Preview')).toBeTruthy()
    expect(view.container.querySelector('iframe')).toBeNull()
    toggleRow(view)
    const iframe = view.container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute('src')).toBe(SAMPLE_URL)
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
  })

  it('renders the summary line alone while the call is running', () => {
    const view = render(<AppPreviewRow {...rowProps(runningApp())} />)
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(view.getByText('App Preview')).toBeTruthy()
  })
})

describe('chat row app-preview body (GenericToolCard fallback)', () => {
  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('expands to the sandboxed live-app iframe from the generic fallback path', () => {
    const view = render(<GenericToolCard {...{
      callId: 'c1', toolName: 'render_app_url', block: settledApp(), openFile: vi.fn(), t,
    }} />)
    expect(view.container.querySelector('iframe')).toBeNull()
    toggleRow(view)
    const iframe = view.container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute('src')).toBe(SAMPLE_URL)
  })
})

/** The registered-key set is pinned by the apply-level surface and HMR tests of the web profile; here the constant export is exercised. */
describe('appPreviewToolview registration', () => {
  it('is exported as the cordis plugin contract', () => {
    expect(appPreviewToolview.name).toBe('app-preview-toolview')
    expect(appPreviewToolview.inject).toEqual(['slots'])
    expect(typeof appPreviewToolview.apply).toBe('function')
  })
})
