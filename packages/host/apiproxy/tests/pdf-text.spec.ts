/**
 * Host-side PDF text extraction: a minimal valid PDF yields its glyph text,
 * non-PDF bytes reject with the typed InvalidPdfError, and a text-less PDF
 * yields the empty string.
 */

import { describe, expect, it } from 'vitest'
import { extractPdfText, InvalidPdfError } from '../src/pdf-text.ts'
import { minimalPdf } from './pdf-fixture.ts'

describe('extractPdfText', () => {
  it('extracts glyph text from a minimal valid PDF', async () => {
    const text = await extractPdfText(minimalPdf('Hello World'))
    expect(text).toContain('Hello World')
  })

  it('rejects bytes with no PDF header as InvalidPdfError', async () => {
    await expect(extractPdfText(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toBeInstanceOf(InvalidPdfError)
  })

  it('rejects a truncated header as InvalidPdfError', async () => {
    const truncated = new TextEncoder().encode('%PDF-1.4\n')
    await expect(extractPdfText(truncated)).rejects.toBeInstanceOf(InvalidPdfError)
  })

  it('returns the empty string when the document draws no text', async () => {
    const text = await extractPdfText(minimalPdf(''))
    expect(text).toBe('')
  })
})
