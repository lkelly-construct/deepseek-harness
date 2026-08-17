// @vitest-environment jsdom
// HtmlPreviewBlock: renders the html source in a sandboxed iframe via srcdoc,
// with the default allow-scripts sandbox (and the tool-declared value when one
// is given), a declared-width override when present, and a copy-source control
// that flips to the copied state and back. The iframe keeps the HTML out of the
// parent DOM (srcdoc, not innerHTML), carries referrerPolicy no-referrer, and
// never gets allow-same-origin from the default.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { HtmlPreviewBlock } from '../src/index.ts'

afterEach(cleanup)

const sampleHtml = '<h1>Hi</h1><script>window.x = 1</script>'

describe('HtmlPreviewBlock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom lacks the async Clipboard API; the component's writeClipboard call
    // must not reject on the click path.
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the html through srcdoc in a sandboxed iframe', () => {
    const { container } = render(<HtmlPreviewBlock html={sampleHtml} />)
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute('srcdoc')).toBe(sampleHtml)
    // Never allow same-origin: the default sandbox is allow-scripts only.
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe!.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('honors a tool-declared sandbox and width', () => {
    const { container } = render(<HtmlPreviewBlock html={sampleHtml} sandbox="none" width={640} />)
    const iframe = container.querySelector('iframe')
    expect(iframe!.getAttribute('sandbox')).toBe('none')
    expect(iframe!.getAttribute('style')).toContain('width: 640px')
  })

  it('renders without a width override when absent', () => {
    const { container } = render(<HtmlPreviewBlock html={sampleHtml} />)
    const iframe = container.querySelector('iframe')
    expect(iframe!.getAttribute('style')).toBeNull()
  })

  it('copies the source and flips the button through the copied state', () => {
    const { getByRole } = render(
      <HtmlPreviewBlock html={sampleHtml} labels={{ copyLabel: 'Copy', copiedLabel: 'Copied' }} />,
    )
    const button = getByRole('button') as HTMLButtonElement
    expect(button.getAttribute('aria-label')).toBe('Copy')
    expect(button.textContent).toBe('Copy')
    fireEvent.click(button)
    expect(button.getAttribute('aria-label')).toBe('Copied')
    expect(button.textContent).toBe('Copied')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(sampleHtml)
    // The copied state clears after the confirmation window.
    act(() => { vi.advanceTimersByTime(2000) })
    expect(button.textContent).toBe('Copy')
  })

  it('falls back to default labels when the caller supplies none', () => {
    const { getByRole } = render(<HtmlPreviewBlock html={sampleHtml} />)
    const button = getByRole('button') as HTMLButtonElement
    expect(button.getAttribute('aria-label')).toBe('复制源码')
    fireEvent.click(button)
    expect(button.getAttribute('aria-label')).toBe('已复制')
  })

  it('merges a caller className onto the wrapper', () => {
    const { container } = render(<HtmlPreviewBlock html={sampleHtml} className="row-preview" />)
    expect(container.querySelector('[data-html-preview]')!.classList.contains('row-preview')).toBe(true)
  })
})