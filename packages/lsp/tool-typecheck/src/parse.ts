/**
 * Pure parsing of `tsc --noEmit --pretty false` output (the standard
 * `file(line,col): error TSxxxx: message` form) into the seam's {@link LspDiagnostic} shape.
 * Multiline messages fold their indented continuation lines; the trailing `Found N errors.`
 * summary and blank separators are dropped. No I/O.
 * @module @deepseek-ai/dsh-tool-typecheck/parse
 */

import type { LspDiagnostic } from '@deepseek-ai/dsh-lsp'

/** One tsc error line: an absolute or relative path, 1-based line/column, code, and message. */
const TSC_ERROR_LINE = /^([^(\n]+)\((\d+),(\d+)\): error (TS\d+): (.*)$/

/** The `Found N errors.` tail line, which is not part of any diagnostic message. */
const SUMMARY_LINE = /^Found \d+ errors?\.?$/

/** A mutable diagnostic under construction, so message continuations can extend it. */
interface OpenDiagnostic {
  severity: 1
  code: string
  message: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
}

/**
 * Parse complete `tsc --noEmit --pretty false` output into normalized diagnostics. Severity is
 * always 1 (error); the code is the `TSxxxx` group; the range is the zero-width cursor at the
 * reported position (lines/columns are 1-based on the wire and become zero-based here).
 * @param text - the tsc stdout (or stderr), split on newlines internally.
 * @returns the parsed diagnostics in emission order; empty for clean output.
 */
export function parseTscOutput(text: string): LspDiagnostic[] {
  const diagnostics: LspDiagnostic[] = []
  let open: OpenDiagnostic | undefined
  for (const line of text.split(/\r?\n/)) {
    const match = TSC_ERROR_LINE.exec(line)
    if (match !== null) {
      const startLine = Number(match[2]) - 1
      const character = Number(match[3]) - 1
      const code = match[4]
      const message = match[5]
      if (code === undefined || message === undefined) continue
      const diagnostic: OpenDiagnostic = {
        severity: 1,
        code,
        message,
        range: {
          start: { line: startLine, character },
          end: { line: startLine, character },
        },
      }
      diagnostics.push(diagnostic)
      open = diagnostic
      continue
    }
    if (open === undefined || line.trim() === '' || SUMMARY_LINE.test(line)) {
      // A blank line or the summary ends a continuation block; junk before any error is skipped.
      open = undefined
      continue
    }
    // An indented continuation of the open diagnostic's wrapped message.
    open.message = `${open.message}\n${line}`
  }
  return diagnostics
}
