# @deepseek-ai/dsh-attachment

The durable attachment seam. `ctx.attachments` validates and durably commits immutable image bytes, then returns a serializable `ImageAttachmentRef`; consumers never persist browser paths, object URLs, provider URLs, or base64 in session events.

Unsent composer images remain browser-owned temporary drafts. `validateImage` runs the same admission policy without persisting. `saveImages` owns batch count and aggregate-byte limits, validates every member before writing any member, then commits in order and returns references only after the complete batch succeeds. A later storage failure returns no partial references, although an earlier immutable content-addressed object may remain unreachable until reference-aware garbage collection exists. `AttachmentError.code` uses the closed `AttachmentErrorCode` string union. Its `ImageAdmissionErrorCode` subset marks caller-correctable image-input failures; `isImageAdmissionError` recognizes that subset at runtime so each protocol adapter can map its own error vocabulary. The `TextFileAdmissionErrorCode` subset (`UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`, `TOO_MANY_FILES`, `INVALID_PDF`) marks caller-correctable inlined text-file and PDF intake failures; those codes are raised by the host at prompt admission in [`@deepseek-ai/dsh-host-apiproxy`](../../host/apiproxy/README.md), which is why an image-only seam owns the file-intake vocabulary. `saveImage` commits one accepted image before any model-visible session event is published, and `readImage` verifies the content-addressed object against its logged metadata. Callers may cancel `readImage`; implementations observe cancellation around backend and verification work and preserve it instead of translating it into a storage failure.

## Model Experience

Indirectly, through the role-neutral core `ImageBlock` and provider adapters that resolve its durable reference.

#### KV Cache effect

Adding an image changes the provider request and therefore invalidates the affected request suffix.

## Known Limitations and Deferred Work

- Version one accepts PNG, JPEG, WebP, and GIF only.
- Retention and garbage collection are deferred because resumed and forked sessions may share immutable objects.
- Text files and PDFs do not persist through this seam: they ship as inlined `text-file` content blocks in the host (extract-and-drop, no bytes retained); only this package's error vocabulary extends to their intake. Audio, video, and persistent unsent drafts require separate lifecycle and provider contracts.
