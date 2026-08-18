// @vitest-environment jsdom
// AppPreviewBlock: renders the live-app URL in a sandboxed iframe via src,
// with the default allow-scripts allow-same-origin sandbox (and the
// tool-declared value when one is given), a declared-width override when
// present, and a copy-URL control that flips to the copied state and back. The
// iframe loads a real URL (src, not srcdoc), carries referrerPolicy
// no-referrer, and never gets allow-popups or allow-top-navigation from the
// default.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { AppPreviewBlock } from '../src/index.ts'

afterEach(cleanup)

const sampleUrl = 'http://localhost:5173'

describe('AppPreviewBlock', () => {
  let writeText: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom lacks the async Clipboard API; the component's writeClipboard call
    // must not reject on the click path.
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the url through src in a sandboxed iframe', () => {
    const { container } = render(<AppPreviewBlock url={sampleUrl} />)
    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute('src')).toBe(sampleUrl)
    // The default allows scripts and same-origin so a running app can load its
    // own assets, but never popups or top-level navigation.
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(iframe!.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('honors a tool-declared sandbox and width', () => {
    const { container } = render(<AppPreviewBlock url={sampleUrl} sandbox="none" width={640} />)
    const iframe = container.querySelector('iframe')
    expect(iframe!.getAttribute('sandbox')).toBe('none')
    expect(iframe!.getAttribute('style')).toContain('width: 640px')
  })

  it('renders without a width override when absent', () => {
    const { container } = render(<AppPreviewBlock url={sampleUrl} />)
    const iframe = container.querySelector('iframe')
    expect(iframe!.getAttribute('style')).toBeNull()
  })

  it('copies the url and flips the button through the copied state', () => {
    const { getByRole } = render(
      <AppPreviewBlock url={sampleUrl} labels={{ copyLabel: 'Copy', copiedLabel: 'Copied' }} />,
    )
    const button = getByRole('button') as HTMLButtonElement
    expect(button.getAttribute('aria-label')).toBe('Copy')
    expect(button.textContent).toBe('Copy')
    fireEvent.click(button)
    expect(button.getAttribute('aria-label')).toBe('Copied')
    expect(button.textContent).toBe('Copied')
    expect(writeText).toHaveBeenCalledWith(sampleUrl)
    // The copied state clears after the confirmation window.
    act(() => { vi.advanceTimersByTime(2000) })
    expect(button.textContent).toBe('Copy')
  })

  it('falls back to default labels when the caller supplies none', () => {
    const { getByRole } = render(<AppPreviewBlock url={sampleUrl} />)
    const button = getByRole('button') as HTMLButtonElement
    expect(button.getAttribute('aria-label')).toBe('复制 URL')
    fireEvent.click(button)
    expect(button.getAttribute('aria-label')).toBe('已复制')
  })

  it('merges a caller className onto the wrapper', () => {
    const { container } = render(<AppPreviewBlock url={sampleUrl} className="row-preview" />)
    expect(container.querySelector('[data-app-preview]')!.classList.contains('row-preview')).toBe(true)
  })
})
