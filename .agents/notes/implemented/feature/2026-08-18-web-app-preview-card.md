# Agent Note: App preview card — a live running-app URL loads in the client

Status: implemented

## Problem

A user building an application in a Harness session has no way to see the running app as it forms. The closest shipped preview, the [html preview card](2026-08-17-web-html-preview-card.md), renders a *static HTML snapshot* the model supplies through `srcdoc`; it cannot display a live dev server whose HTML, scripts, and assets come from a server the model started over bash. The render-intent vocabulary ([tool-render-intent-union](../architecture/2026-07-02-tool-render-intent-union.md)) has no card that says "this result is a live localhost URL, load it in a sandboxed iframe". Claude Code answers this by opening the running app in a window; the Harness web GUI has no such live-app surface.

## Decision

Add a result-side `app-preview` card to the render-intent union by extending the shipped client primitive set, without a new card on the `ToolResultView` union: the client reads `resultView` for `card === 'app-preview'` through a new `appPreviewCardModel` derivation (parallel to `htmlPreviewCardModel`) and draws a new `AppPreviewBlock` primitive. `AppPreviewBlock` is the live-app counterpart of `HtmlPreviewBlock`: an `<iframe src={url}>` — `src`, not `srcdoc`, because the content comes from a running server — with a default `sandbox="allow-scripts allow-same-origin"` (the running app needs same-origin access to load its own assets), `referrerPolicy="no-referrer"`, an optional declared `width` viewport hint, and a copy-URL control. Unlike the HTML card, `allow-same-origin` is on by default because a real app cannot otherwise reference its own scripts and styles; the sandbox stays a user-level last line, and a tool may narrow it.

The model flow is: start the app's dev server via bash, read the `http://localhost:<port>` URL from the server output, then call a tool with that URL so `presentResult` surfaces the `app-preview` card. The shipped demo realization is the `@deepseek-ai/dsh-tool-app-preview` example package: a host-only `render_app_url` tool that carries the model-supplied URL into the card through its `presentResult`, anchored by the `apps/cli` dependency and registered in the web profile scope and a user preset root for the browser demo. The card is result-only: the pending state stays a `GenericCallView` because the URL exists only after `execute` returns. The generic fallback keeps rendering the model-facing text, so a client that does not know the card is unaffected.

Client wiring follows the [tool-card precedent](2026-07-30-web-read-card.md): `appPreviewCardModel`, the `AppPreviewRow` keyed toolview registered under `render_app_url`, the `GenericToolCard` fallback, and both render sites draw the primitive. The new package and tool are catalogued in `scripts/gen-tool-catalog.ts` `TOOL_PACKAGES` and the regenerated `docs/tool-catalog.md`.

## Alternatives considered

**Rendering the running app inside the existing `HtmlPreviewBlock` by switching it from `srcdoc` to `src`.** Rejected: conflating the two cards weakens the HTML card's `allow-scripts`-only default (which must stay off `allow-same-origin` for untrusted markup) and muddies the tool's intent. A static HTML snapshot and a live server URL are different trust surfaces and deserve distinct cards.

**Routing through the E2B sandbox.** Rejected as the shipped path: the E2B package is a POC, and the app-preview flow deliberately keeps the dev server local (started via bash) so no remote sandbox is required to surface the URL. E2B port-forwarding into a preview card remains a possible follow-up, not this change.

**Auto-detecting the dev server and opening it without a tool call.** Rejected at this stage: surfacing a preview should be an explicit, model-started handoff (the same model-visible reasoning that keeps the HTML card tool-driven), and auto-discovery of a "current" server is ambiguous while several processes may listen.

## Consequences

The client surface stays generic-by-default for every other tool. The result text remains the source of truth for model-visible content; the `app-preview` card is a presentation overlay like `web`, and a GUI without the capability falls back to the model-facing text.

The running-app preview depends on the dev server still being reachable from the browser at the moment the iframe loads: the tool only surfaces the URL, and a stopped server renders a connection error in the card. Nothing in this change starts, probes, or keeps the server alive; that is the model's job through bash.

## Testing

The unit suites cover the `render_app_url` tool definition and presenters (`tool-app-preview.spec.ts`), the invariant companion (`invariant.spec.ts`), the `AppPreviewBlock` primitive (`app-preview-block.client.spec.tsx`), and the `appPreviewCardModel` / `AppPreviewRow` / `GenericToolCard` fallback render sites (`app-preview-card.client.spec.tsx`). The `gen-tool-catalog.spec.ts` guarantee boots the new tool and harvests its schema.

## Related

- [tool-render-intent-union](../architecture/2026-07-02-tool-render-intent-union.md)
- [2026-08-17-web-html-preview-card](2026-08-17-web-html-preview-card.md) — the static-HTML card this extends with a live-URL variant
- [2026-07-30-web-read-card](2026-07-30-web-read-card.md) — the result-side-card precedent this follows