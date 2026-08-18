// AppPreviewBlock: renders a running app URL in a sandboxed iframe so the user
// can see a live preview of what the agent built. The iframe uses `src` (a real
// localhost URL supplied by the tool) instead of `srcdoc`, and carries a
// sandbox attribute — scripts and same-origin are allowed by default so the
// running app can load its own assets, but popups and top-level navigation are
// blocked. A copy-URL button lets the user grab the URL. The card geometry
// mirrors CodeBlock/TerminalBlock/HtmlPreviewBlock so it reads as one family.
import { useState } from 'react'
import clsx from 'clsx'
import { writeClipboard } from './clipboard.ts'
import css from './AppPreviewBlock.module.css'

/**
 * Props for the app preview card. Mirrors the tool contract's
 * `RenderAppUrlView` fields plus layout controls.
 */
export interface AppPreviewBlockProps {
  /** The localhost URL to render as the iframe src. */
  url: string
  /** Preferred width hint in pixels for the iframe viewport. */
  width?: number | undefined
  /** Sandbox directives for the iframe. Defaults to `'allow-scripts allow-same-origin'`. */
  sandbox?: string | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /** Labels for the copy button states. */
  labels?: AppPreviewLabels | undefined
}

/** Copy-button labels forwarded to the preview card. */
export interface AppPreviewLabels {
  /** Copy-button idle label. */
  copyLabel?: string | undefined
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel?: string | undefined
}

const DEFAULT_SANDBOX = 'allow-scripts allow-same-origin'

/**
 * Derive the iframe sandbox attribute: the tool's explicit value when present,
 * otherwise the safe default that allows scripts and same-origin access (for a
 * live running app to load its own assets) while blocking popups and navigation.
 * @param sandbox - the tool-declared sandbox, if any.
 * @returns the sandbox string for the iframe element.
 */
function resolveSandbox(sandbox: string | undefined): string {
  return sandbox ?? DEFAULT_SANDBOX
}

/**
 * The app preview card body: the sandboxed live-app iframe over a toolbar with a
 * copy-URL button. The iframe stretches to fill the card width (or the declared
 * width), and its height is capped so a long preview scrolls internally rather
 * than growing the card.
 * @param props - see {@link AppPreviewBlockProps}.
 * @returns the preview card element.
 */
export function AppPreviewBlock({
  url, width, sandbox, className, labels,
}: AppPreviewBlockProps) {
  const [copied, setCopied] = useState(false)
  const resolvedSandbox = resolveSandbox(sandbox)

  const handleCopy = () => {
    void writeClipboard(url)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 2000)
  }

  // Resolve the copy control's label once so the visible text and the accessible
  // name stay identical in both states, even when the caller supplies no labels.
  const copyLabel = copied ? (labels?.copiedLabel ?? '已复制') : (labels?.copyLabel ?? '复制 URL')

  return (
    <div className={clsx(css.block, className)} data-app-preview>
      <div className={css.toolbar}>
        <span className={css.toolbarTitle}>{url}</span>
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
          src={url}
          title="App preview"
          sandbox={resolvedSandbox}
          referrerPolicy="no-referrer"
          style={width !== undefined ? { width: `${width}px` } : undefined}
          className={css.iframe}
        />
      </div>
    </div>
  )
}
