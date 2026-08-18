# @deepseek-ai/dsh-tool-html-preview

English | [中文](README.zh.md)

The model-facing `render_html` tool: a pass-through view producer that returns an `html-preview` GUI card rendering whatever HTML the model supplies.

## What it does

Registers one tool, `render_html({ html, title?, width?, sandbox? })`, on `ctx.tools`. The tool is a pure pass-through: `execute` copies the model's `html` source and the optional `width` / `sandbox` hints into the canonical view value, and `presentResult` returns the `html-preview` card carrying that view. Rendering is entirely client-side — the existing `html-preview` GUI card receives `{ card: 'html-preview', html, width?, sandbox? }` and renders the HTML inside a sandboxed `<iframe>` (via `srcdoc`, never injected into the DOM). This tool only produces the card view; it contains no rendering or iframe concern.

`width` (integer) is a viewport-width hint in pixels; absent uses the container's natural width. `sandbox` (string) narrows the iframe directives; absent defaults to `allow-scripts`. `title` is accepted as a parameter but is not carried into the view or the card.

## The contract

- **Arguments**: `html` (string, required), `title?`, `width?` (integer), `sandbox?` (string).
- **Canonical value**: `{ html, width?, sandbox? }` — the `html` source goes directly into the view; undefined `width` / `sandbox` are omitted entirely.
- **Native renderer**: a compact text block, `` `Rendered <n> bytes of HTML to the preview card.` ``, naming the byte length of the supplied HTML.
- **Card**: `presentResult` returns `{ card: 'html-preview', html, width?, sandbox? }` from the projected view, so a capable GUI shows the live preview; a UI without the capability falls back to the model-facing text.
- **Replay**: the view is projected onto `result.meta` via `output.presentationMeta`, so a session-log replay rebuilds the identical card without persisting the canonical value.

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `apply` and NO default. A stray `export default` would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated `render_html` schema ([tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-html-preview)).

#### Token effect

Fixed schema cost on every request where the tool is visible. The model-supplied `html` argument is also retained in each call's arguments.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each `render_html` call retains the full HTML source in its arguments. Success returns exactly `` `Rendered <n> bytes of HTML to the preview card.` ``. The preview itself is GUI state, not a second model message.

#### Token effect

Token growth scales with the HTML source supplied in each call, which remains in the call arguments until compaction. The result is small and fixed-shape.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Pass-through only** — this demo tool performs no sanitization, transformation, or preview-size limiting of the HTML it forwards; enforcement of what a possibly unprivileged host renders belongs to a future, hardened tool behind this package.
- **`title` is accepted but unused** — the parameter is declared for the model, but `presentResult` does not yet surface it on the card; wiring it to the `HtmlPreviewResultView.title` field is deferred.
- **No sandbox/iframe concern here** — the tool only returns the card view; rendering and iframe enforcement are the client card's job, so this package cannot constrain what executes in the preview.
