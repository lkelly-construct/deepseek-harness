# @deepseek-ai/dsh-tool-app-preview

English | [中文](README.zh.md)

The model-facing `render_app_url` tool: a pass-through view producer that returns an `app-preview` GUI card rendering a running app's localhost URL.

## What it does

Registers one tool, `render_app_url({ url, title?, width?, sandbox? })`, on `ctx.tools`. The tool is a pure pass-through: `execute` copies the model's `url` and the optional `width` / `sandbox` hints into the canonical view value, and `presentResult` returns the `app-preview` card carrying that view. Rendering is entirely client-side — the `app-preview` GUI card receives `{ card: 'app-preview', url, width?, sandbox? }` and loads the URL inside a sandboxed `<iframe>` (via `src`, never injected into the DOM). This tool only produces the card view; it contains no rendering, server, or iframe concern.

The intended flow: the model starts the app's dev server (via a bash tool), reads the `http://localhost:<port>` URL from the server output, then calls `render_app_url` to surface the running app in the GUI window. The user can then look at the live app and direct adjustments.

`width` (integer) is a viewport-width hint in pixels; absent uses the container's natural width. `sandbox` (string) narrows the iframe directives; absent defaults to `allow-scripts allow-same-origin` (the running app needs same-origin access to load its own assets). `title` is accepted as a parameter but is not carried into the view or the card.

## The contract

- **Arguments**: `url` (string, required), `title?`, `width?` (integer), `sandbox?` (string).
- **Canonical value**: `{ url, width?, sandbox? }` — the `url` goes directly into the view; undefined `width` / `sandbox` are omitted entirely.
- **Native renderer**: a compact text block, `` `Rendered <url> as a live app preview card.` ``, naming the URL.
- **Card**: `presentResult` returns `{ card: 'app-preview', url, width?, sandbox? }` from the projected view, so a capable GUI loads the live app; a UI without the capability falls back to the model-facing text.
- **Replay**: the view is projected onto `result.meta` via `output.presentationMeta`, so a session-log replay rebuilds the identical card without persisting the canonical value.

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `apply` and NO default. A stray `export default` would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated `render_app_url` schema ([tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-app-preview)).

#### Token effect

Fixed schema cost on every request where the tool is visible. The model-supplied `url` argument is also retained in each call's arguments.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each `render_app_url` call retains the URL in its arguments. Success returns exactly `` `Rendered <url> as a live app preview card.` ``. The preview itself is GUI state, not a second model message.

#### Token effect

Token growth is small and fixed-shape: the URL is a short string retained in the call arguments until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Pass-through only** — this demo tool performs no URL validation, reachability check, or sandbox hardening of what it forwards; enforcement of what a possibly unprivileged host loads belongs to a future, hardened tool behind this package.
- **`title` is accepted but unused** — the parameter is declared for the model, but `presentResult` does not yet surface it on the card.
- **No sandbox/iframe concern here** — the tool only returns the card view; rendering and iframe enforcement are the client card's job, so this package cannot constrain what executes in the preview.
- **The dev server must already be running** — this tool only surfaces an existing URL; starting and keeping the app's dev server alive is the model's job through a bash tool, and the GUI card will show a connection error if the server is not reachable.
