# Agent Note: HTML preview card — sandboxed live rendering reaches the client

Status: implemented

English | [中文](2026-08-17-web-html-preview-card.zh.md)

## Problem

A tool that produces HTML (a page mockup, a chart wrapper, a report template) had no way to show a user the rendered result. The result surface on the wire is model-facing text only; the markdown renderer deliberately keeps raw HTML out of the DOM, so untrusted HTML never enters the page ([web-assistant-markdown](2026-07-23-web-assistant-markdown.md)). A user editing such a file in a Harness session sees the markup, not the page. Claude Code answers this with a live preview of generated HTML; the Harness render-intent vocabulary ([tool-render-intent-union](../architecture/2026-07-02-tool-render-intent-union.md)) has no card that says "this result is HTML, show it in a sandboxed iframe".

## Decision

Add a result-side `html-preview` card to the render-intent union. `ToolResultView` gains `HtmlPreviewResultView { card: 'html-preview'; title?; html; width?; sandbox? }`. It is result-only: like the search/web/read cards, the pending state stays a `GenericCallView` because the HTML exists only after `execute` returns.

The view carries the complete HTML source in `html`. The client renders it through a new `HtmlPreviewBlock` primitive: an `<iframe srcdoc={html}>` — srcdoc, never `innerHTML` — with a default `sandbox="allow-scripts"` (no `allow-same-origin`, so preview scripts can run but cannot reach the parent page), `referrerPolicy="no-referrer"`, an optional declared `width` viewport hint, and a copy-source control. A tool may narrow the sandbox by passing `sandbox` (e.g. `'none'` for a static page), on the same trust model as every other tool-supplied presentation field: the tool already produces content the model sees, so the sandbox is the user's last line rather than the presentation's first.

Client wiring follows the [tool-card precedent](2026-07-30-web-read-card.md): a `htmlPreviewCardModel` pure derivation in `ui-tool` reads `resultView.card === 'html-preview'` and returns the `HtmlPreviewBlockProps`, and both render sites — the chat tool row's expanded body (`ToolRow`) and the details panel (`ToolDetails`) — draw the primitive. The generic fallback keeps rendering the model-facing text, so a client that does not know the card is unaffected.

## Alternatives considered

**A `bash`-shadowing pretender that shells out to a browser.** Rejected: the user wants the preview inside the session, not a new OS window, and a spawned browser cannot be sandboxed by the page that hosts the session.

**Intercepting html fences in assistant messages.** Rejected at this stage: it would require the markdown pipeline to emit DOM from untrusted HTML, which the web client deliberately does not do. A tool result is an explicit, model-startable handoff; intercepting assistant output would apply previews where the model never asked for them.

## Consequences

The client surface stays generic-by-default for every other tool. The result text remains the source of truth for model-visible content; the new card is a presentation overlay like `web`.

The shipped demo realization is the `@deepseek-ai/dsh-tool-html-preview` example package: a host-only `render_html` tool that carries model-supplied HTML into the card through its `presentResult`, mounted in the web profile scope (and in the deployment's user preset root for the browser demo). The keyless web e2e `apps/web/tests/html-preview.e2e.ts` seeds a settled `render_html` turn under a user preset and asserts the sandboxed `srcdoc` iframe; a real-model round on the same preset reproduces the card in the live GUI.

## Related

- [tool-render-intent-union](../architecture/2026-07-02-tool-render-intent-union.md)
- [2026-07-30-web-read-card](2026-07-30-web-read-card.md) — the result-side-card precedent this follows.