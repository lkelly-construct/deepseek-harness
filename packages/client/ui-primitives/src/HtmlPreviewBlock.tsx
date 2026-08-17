// HtmlPreviewBlock: renders an HTML snippet in a sandboxed iframe so the user
// can see a live preview of the generated markup. The iframe uses `srcdoc` (not
// innerHTML) to keep the HTML out of the parent DOM, with a restrictive
// sandbox attribute — scripts are allowed by default so interactive previews
// work, but same-origin access is blocked so the preview cannot reach back into
// the Harness UI. A copy-source button lets the user grab the raw HTML. The card
// geometry mirrors CodeBlock/TerminalBlock so it reads as one family with other
// tool cards; the whole source list renders inside a fixed-height scroll container
// so a long payload scrolls in place rather than growing the card unbounded.

import { useState } from 'react'
import clsx from 'clsx'
import { writeClipboard } from './clipboard.ts'
import css from './HtmlPreviewBlock.module.css'

/**
 * Props for the HTML preview card. Mirrors the contract's
 * {@link HtmlPreviewResultView} fields plus layout controls.
 */
export interface HtmlPreviewBlockProps {
  /** The complete HTML source to render in the iframe. */
  html: string
  /** Preferred width hint in pixels for the iframe viewport. */
  width?: number | undefined
  /** Sandbox directives for the iframe. Defaults to `'allow-scripts'`. */
  sandbox?: string | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /** Labels for the copy button states. */
  labels?: HtmlPreviewLabels | undefined
}

/** Copy-button labels forwarded to the preview card. */
export interface HtmlPreviewLabels {
  /** Copy-button idle label. */
  copyLabel?: string | undefined
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel?: string | undefined
}

const DEFAULT_SANDBOX = 'allow-scripts'

/**
 * Derive the iframe sandbox attribute: the tool's explicit value when present,
 * otherwise the safe default that allows scripts (for interactive previews)
 * while blocking same-origin access and form submission.
 * @param sandbox - the tool-declared sandbox, if any.
 * @returns the sandbox string for the iframe element.
 */
function resolveSandbox(sandbox: string | undefined): string {
  return sandbox ?? DEFAULT_SANDBOX
}

/**
 * The HTML preview card body: the sandboxed iframe over a toolbar with a copy
 * button. The iframe stretches to fill the card width (or the declared width),
 * and its height is capped so a long preview scrolls internally rather than
 * growing the card.
 * @param props - see {@link HtmlPreviewBlockProps}.
 * @returns the preview card element.
 */
export function HtmlPreviewBlock({
  html, width, sandbox, className, labels,
}: HtmlPreviewBlockProps) {
  const [copied, setCopied] = useState(false)
  const resolvedSandbox = resolveSandbox(sandbox)

  const handleCopy = () => {
    writeClipboard(html)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Resolve the copy control's label once so the visible text and the accessible
  // name stay identical in both states, even when the caller supplies no labels.
  const copyLabel = copied ? (labels?.copiedLabel ?? '已复制') : (labels?.copyLabel ?? '复制源码')

  return (
    <div className={clsx(css.block, className)} data-html-preview>
      <div className={css.toolbar}>
        <span className={css.toolbarTitle}>预览</span>
        <button
          type="button"
          className={clsx(css.copyButton, copied && css.copied)}
          onClick={handleCopy}
          aria-label={copyLabel}
        >
          {copyLabel}
        </button>
      </div>
      <div className={css.iframeWrap}>
        <iframe
          srcDoc={html}
          title="HTML preview"
          sandbox={resolvedSandbox}
          referrerPolicy="no-referrer"
          style={width !== undefined ? { width: `${width}px` } : undefined}
          className={css.iframe}
        />
      </div>
    </div>
  )
}
