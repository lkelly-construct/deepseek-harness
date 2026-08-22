# Agent Note: image-router redacts served images from derived history so the base text route resumes

Status: implemented

## Problem

A session that serves an image on one step must route that step to a vision-capable model (a text-only adapter rejects any request whose history still carries an image). Once the image has been served, the session should return to its base route — but presence-based routing alone never switches back, because the image block remains in the derived history for every later step. The vision route therefore dragged on for the whole session after a single pasted image or image-returning tool call, even once the conversation was plain text again.

The mechanism for "the image leaves derived history" did not exist. The attachment work modeled an image as a durable `ImageBlock` reference on the model-visible surface, and a text-only route refuses a history that carries one (`llm-deepseek` throws `UNSUPPORTED_CONTENT`); nothing replaced a served image with a placeholder so the base route could take back over. PR #598 had proposed a reversible `image-placeholder-v1` history projection coupled to new agent-loop machinery and three new session-log concepts, and was [withdrawn in the read-image tool note](../feature/2026-08-10-minimal-read-image-tool.md) as too much surface for the capability it bought.

## Decision

The `image-router` function plugin routes presence-based and then redacts served images from the derived history at the next turn's first step, using the session's existing model-only surface replacement — no new agent-loop machinery and no new durable event type.

**Presence-based routing.** The `agent/request` listener (registered on the HOST context, so it is the outermost listener and sees the config `installModelSelection` already applied) routes to a configured `imageProvider`/`imageModel` whenever any derived message contains an image block. It checks the vision model declares image input through `ctx.llm.resolveModelInfo` and throws if not — a misconfigured deployment fails loud. When no derived message carries an image and the applied config already equals this plugin's image route, it unwinds to `agent.options` provider/model; when the applied config differs (a manual or base selection), it leaves the applied config unchanged.

**Redaction at the next turn's first step.** Once the turn that supplied the image has been served by the vision route, the image must not leak back into a text-only request. The `agent/pre-step` listener fires at `step === 1` and only when the fresh turn's own claimed messages carry no image; it then calls `redactImagesFromHistory(session)`, which walks the session surface, finds `user/message` and `tool/result` events whose content contains an image, and appends a model-only surface-replace whose image blocks are replaced by the text `[image]` (the `IMAGE_PLACEHOLDER` constant). The human transcript (`isAppendSurfaceEvent`) keeps the original blocks; only derived, model-visible history drops them. `redactImages` recurses into nested `tool-result` content so a tool return that embedded an image is scrubbed too. A turn whose own claimed input still carries an image keeps it — the vision route must see it that turn — and a mid-turn continuation step does not redact.

The plugin exports `name`, `inject: ['llm']`, and `apply`, and `ctx.provide('image-router', { provider, model })` so the Web image-admission gate can admit pasted images when only the vision route is image-capable.

## Alternatives considered

- **PR #598's reversible history projection on `agent/request-ready`** — achieved "text routes continue over placeholder text" but required a new agent-loop extension point, three new durable session-log concepts (`agent/request-ready`, `messageProjection`, availability notices), and per-step registration churn. The surface-replace mechanism already ships in the session and carries none of that; the `agent/pre-step` + `agent/request` pair reuses existing extension points.
- **Always route every image-bearing step and never switch back** — the status quo the plugin replaces; the vision route held even after only text remained, wasting a more expensive model and diverging from the session's base selection.
- **Let the text adapter degrade by dropping the image silently** — rejected for the whole codebase: every adapter must refuse rather than flatten, so returning to text requires removing the image from model-visible history, which is exactly what this plugin does.
- **Redact at the end of the image-bearing turn** — the image must stay visible to the vision model for that turn's later tool-result steps (a step may reason about its own claimed image repeatedly), so redaction correctly waits for the next turn's first text-only step.

## Consequences

The base text route resumes on the step after the image-bearing turn instead of the vision route holding for the session. The redaction is durable (a surface-replace in the session log) but model-only, so the human transcript keeps the actual image while the base model sees a `[image]` placeholder in its position; the adjacent assistant message carries the vision model's description. A fresh turn that claims its own image is not redacted, so the vision route still serves it.

Known limitation, deferred: the vision model must still fit the whole request on the image-bearing step. The router selects the route; it does not compact history, subsample the image, or otherwise buy the image room on that step, so a very long conversation that first gains an image late may exceed the vision model's context on that one request.

The previous withdrawn projection proposal in [the read-image feature note](../feature/2026-08-10-minimal-read-image-tool.md) is not superseded: this plugin achieves "text routes continue over placeholder text" through surface-replace at the routing layer, rather than the agent-loop registration machinery that proposal introduced. That note's withdrawn design remains the reference for a per-route projection if one is ever needed below the session surface.

## Testing

`packages/routing/image-router/tests/index.spec.ts` (vitest) mounts `apply` on a hand-built Cordis `Context` and exercises the listeners through `agentEvents(...)`: config validation throws for empty `imageProvider`/`imageModel`; an image-bearing session routes to the vision route (and forwards the abort signal and the modality declaration is consulted); a no-image session unwinds to `agent.options` when the applied route is ours and leaves a non-image manual extension selection untouched; a misconfigured vision model (no `image` in `inputModalities`) throws; and `agent/pre-step` redacts both a served `user/message` image and a `tool/result` image into `[image]` text at `step === 1` while keeping a fresh turn that still carries an image and leaving mid-turn steps untouched. The type gate (`pnpm exec tsc -b packages/routing/image-router/tsconfig.json`) stays green.
