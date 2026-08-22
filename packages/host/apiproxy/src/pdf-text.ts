/**
 * Host-side PDF text extraction for inlined file attachments. Client bundles
 * never import this module: it is reachable only from the apiproxy host path,
 * where a PDF upload is decoded once and its extracted text is emitted as a
 * durable `text-file` content block.
 *
 * @module @deepseek-ai/dsh-host-apiproxy/pdf-text
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/**
 * Maximum number of pages one PDF upload contributes. Fixed, not a deployment
 * knob: an unbounded page count lets one upload monopolize the host's CPU, so
 * the cap is a security invariant rather than a tuning choice.
 */
export const MAX_PDF_PAGES = 1000

/**
 * One PDF whose bytes do not parse as a PDF document. Raised for truncated
 * files, garbage bytes, and structurally invalid PDFs alike; the admission
 * path maps this to the `INVALID_PDF` attachment error at the wire boundary.
 */
export class InvalidPdfError extends Error {
  constructor(options?: ErrorOptions) {
    super('PDF text extraction failed: the upload is not a valid PDF document', options)
    this.name = 'InvalidPdfError'
  }
}

/**
 * Extract the joined per-page text of one PDF byte stream.
 * @param bytes - the raw PDF file bytes.
 * @returns page text joined by newlines, trimmed; `''` when no page yielded text.
 * @throws {InvalidPdfError} when the bytes do not parse as a PDF document.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const loadingTask = getDocument({ data: bytes })
  let pdf
  try {
    pdf = await loadingTask.promise
  } catch (error: unknown) {
    throw new InvalidPdfError({ cause: error })
  }
  try {
    const pages: string[] = []
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES)
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      // TextContent carries TextItem and TextMarkedContent entries; only text
      // items have a `str`, and markers must not contribute glyphs.
      const text = (content.items as ReadonlyArray<{ str?: unknown }>)
        .map(item => (typeof item.str === 'string' ? item.str : ''))
        .join('')
      pages.push(text)
    }
    return pages.join('\n').trim()
  } finally {
    await pdf.cleanup()
  }
}
