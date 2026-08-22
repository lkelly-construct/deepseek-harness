/**
 * Offline minimal valid PDF fixture. Generates a one-page `%PDF-1.4` file with
 * a single text object and a correct xref table, so pdfjs exercises real
 * lexing/object/xref paths without any network access. The file is byte-exact
 * and deterministic for a given text argument.
 */

const textEncoder = new TextEncoder()

function byteLength(text: string): number {
  return textEncoder.encode(text).length
}

/**
 * Build one minimal valid one-page PDF whose content stream draws `text` in
 * the standard Helvetica font, with a correctly offset xref table.
 * @param text - the single text glyph run; `''` yields an empty text object.
 * @returns the encoded PDF bytes.
 */
export function minimalPdf(text = 'Hello World'): Uint8Array {
  const stream = `BT\n/Helv 12 Tf\n72 720 Td\n(${text}) Tj\nET\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /Helv 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(byteLength(body))
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefStart = byteLength(body)
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) tail += `${String(offset).padStart(10, '0')} 00000 n \n`
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return textEncoder.encode(body + tail)
}
