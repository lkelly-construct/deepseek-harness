# Agent Note: Text and PDF file attachments in the Web composer

Status: implemented

## Problem

The Web composer's attachment rail accepted raster images only. Text files and PDFs were refused at intake, so a user could not attach a source file, diff, or document for the model to read. The [image attachment decision](2026-07-22-web-multimodal-image-input-and-durable-attachments.md) named "generic files" and "PDF" as follow-ups; this decision ships the text-ish subset of that gap.

The image design's constraints still apply: anything model-visible must be reconstructible from the session log (model-visible ⟺ logged), and the composer must not hand the model a transient binary the log cannot reproduce. Text files and PDFs need a model-visible representation adapters can serialize without a durable byte store, because their bytes are not rendered in history the way images are.

## Decision

Inline text files and PDFs share one durable core content block, `text-file` (`{type: 'text-file'; name; mediaType; text}`), added to the merge-extensible `ContentBlockMap`. The block carries the extracted text inline rather than bytes, and every adapter serializes it as `[file: <name>]` plus a newline plus the text. `text-file` is the single model-visible and logged representation of an attached text-ish file or PDF; there is no durable binary file block.

### Why inline text, not a durable binary attachment block

Images needed an immutable object store because their bytes are the model input and must survive session resume and fork. Text files and PDFs do not: their model-meaningful form is the extracted text, which is small and loggable. A durable binary block would reference bytes the log does not carry, breaking the model-visible ⟺ logged invariant and forcing every adapter to re-resolve bytes per request. Inlining text keeps the images path untouched and makes the log self-sufficient.

### Admission and precedence

`session.prompt` gains two wire parts: `text-file` (the browser already read the file as UTF-8: `{name, mediaType, text}`) and `file` (base64 PDF bytes: `{name, mediaType: 'application/pdf', data}`). Admission runs host-side in `durablePromptContent`, validated as a complete batch before any durable image object is published:

- Inlined text files must match the host allow-list (`application/json`, `text/plain`, `text/x-python`, `text/markdown`, `text/csv`, `text/xml`) and stay under `DEFAULT_MAX_TEXT_FILE_BYTES` (512 KiB) per file and `DEFAULT_MAX_TEXT_FILES_PER_MESSAGE` (10) per prompt.
- PDFs admit `application/pdf` only, under `DEFAULT_MAX_PDF_BYTES` (20 MiB) per file and `DEFAULT_MAX_PDF_FILES_PER_MESSAGE` (5).
- PDF bytes are decoded and extracted host-side with `pdfjs-dist` (legacy build, `extractPdfText`, `MAX_PDF_PAGES=1000`) and emitted as a `text-file` block with `mediaType: 'application/pdf'`. The model and the client bundle never see raw PDF bytes; the browser uploads base64 only because it cannot run the extractor, and only the extracted text is durably logged.
- A PDF whose pages yield no text (image-only or scanned) becomes `EMPTY_PDF_TEXT_PLACEHOLDER`, never a silent empty block.

Caller-correctable failures reuse `AttachmentError` with a new `TextFileAdmissionErrorCode` subset — `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`, `TOO_MANY_FILES`, `INVALID_PDF` — alongside the existing image codes.

### Composer intake and rendering

`InputBar` routes picked or dropped files by browser-declared MIME type: text/PDF types go to `addFiles`, everything else (images and unsupported non-files) to `addImages`, whose own validation rejects non-images. Text files serialize via `file.text()` into `text-file` parts; PDFs via `arrayBuffer()` plus base64 into `file` parts. Draft files render as a `TextFileChip` (filename, media type, size, remove control) in `ui-attachment`; history renders each `text-file` block as a filename chip in `MessageItem.tsx`, reading only `name` and `mediaType`.

### Compaction

`compaction-basic` inlines `text-file` blocks in the summary projection (`[file: <name>]` plus text) instead of dropping them, so attached file text survives compaction.

### Model-selection fix

`selectModel` records the switch in a per-session `sessionModelOverrides` map keyed by session id, so the choice survives agent renewal. The getter precedence on every read is: live in-process selection, session override, the session's latest logged request header, then the deployment default.

## Alternatives considered

### A durable binary file/attachment block

Rejected: it re-opens the object-store problem for data whose model-meaningful form is small text. A reference in the log needs per-request byte re-resolution and breaks model-visible ⟺ logged unless the bytes are also logged, which duplicates the inline text anyway.

### Store PDF bytes and resolve them per request, like images

Rejected: PDFs are not a rendered modality in history, their bytes run up to 20 MiB each, and the model reads extracted text, not bytes. Extracting once at admission keeps the log bounded and matches the model-visible form.

### Send raw PDF bytes to the model as a provider "file" part

Rejected: no shipping adapter models a durable local file handle and there is no cross-provider file vocabulary; per-provider file encoding is adapter-specific and unreplayable from the neutral log. Extract-to-text is provider-neutral and replay-safe.

### Keep text-file text out of compaction summaries

Rejected: silently dropping attached file text from a checkpoint loses context the model needs to resume — the same failure image compaction already guards against.

## Testing

Host admission tests (`api-proxy-files.spec.ts`) cover text-file allow-list, byte/count caps, canonical-base64 rejection, and PDF extraction to a `text-file` block, including `FILE_TOO_LARGE`, `TOO_MANY_FILES`, and `INVALID_PDF`. `pdf-text.spec.ts` covers extraction and `InvalidPdfError`. Adapter tests pin the `[file: <name>]` inlining; client tests cover routing text/PDF to `addFiles` versus images, the `TextFileChip`, and history folding. The model-selection override regression lives in `api-proxy-models.spec.ts`.

## Consequences

- `text-file` is now a core content block every adapter and compaction path must honor; a block type added without adapter, UI, and compaction support fails those shipping paths (the documented `ContentBlockMap` rule).
- Original file bytes are extract-and-drop: `name` and extracted `text` are durable, but the original bytes (the PDF in particular) are not retained, so downloading the original file is deferred work.
- Image-only or scanned PDFs contribute only placeholder text, not their visual content, so the model cannot read them.
- Compaction preserves the file text and the `text-file` block's `name`, not the original filename/bytes in binary form.
- The DeepSeek and pi-ai adapters inline `text-file` identically; the text-only DeepSeek adapter continues to reject `image` explicitly.
