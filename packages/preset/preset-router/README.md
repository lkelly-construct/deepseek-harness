# @deepseek-ai/dsh-preset-router

Host service that auto-selects the agent preset for a blank session from its first human prompt. The Web gateway's `session.prompt` path consults `ctx.presetRouter` before `followup`, then applies the returned preset id through the agent-presets `recompose` seam and records it as an `agent-preset/selected` event, exactly like a manual picker choice. Classification is best-effort: an unavailable roster, an over-long or image-only prompt, a timeout, or an unclear answer leaves the session on its deployment default, so a router problem never blocks a first message.

## Config

| Key | Required | Meaning |
|---|---:|---|
| `maxInputBytes` | yes | Maximum UTF-8 bytes in the JSON-framed human request sent to the classifier. |
| `maxOutputTokens` | yes | Output-token cap for one classification call. |
| `timeoutMs` | yes | End-to-end deadline for one classification call, in milliseconds. |
| `provider` | no | Explicit classifier route; must be paired with `model`. |
| `model` | no | Explicit classifier model id; must be paired with `provider`. |

Absent `provider`/`model`, the classifier runs on the caller's current session model selection (`selectionFor(agent).current` in the Web gateway), which is the same model the first turn would use.

## Service

`presetRouter` exposes `routeForPrompt`, consumed optionally by the host gateway:

```ts
import type { PresetRouteRequest } from '@deepseek-ai/dsh-preset-router'

declare function routeForPrompt(request: PresetRouteRequest): Promise<string | undefined>
```

The response is a preset id from the live roster, or `undefined` to keep the default. The router composes nothing and mounts nothing; the caller owns the swap, so this service stays swappable and never races a session's lifecycle.

## Events

- `preset-route/llm-request` — log-only, appended before one auxiliary classification dispatch. Carries the exact route, system prompt, message list, and token cap so the model-visible request is reconstructable from the session log (the repository's model-visible ⟺ logged rule).

## Model Experience

### Auxiliary classifier request

#### What the model sees

A blank session's first prompt triggers one auxiliary model call before the session's own first turn starts. A fixed system instruction lists the live roster as JSON (`id`, optional `name`/`description`) and demands exactly one id or the literal `DEFAULT`, plus one user message framing the human prompt text as JSON. The exact literal is built in `src/index.ts` (`systemPrompt` and `frameRequest`); prompts with no text blocks (image-only) or longer than `maxInputBytes` are never classified.

#### Token effect

The classification call consumes output tokens up to `maxOutputTokens` and input tokens of `systemPrompt` plus the framed request, minus the request's non-text blocks. It is a one-off before the first turn, not part of either the system prompt or the conversation history the session's model sees.

#### KV Cache effect

The auxiliary call is an independent model request on a fixed system prefix; the framed human text is the only varying input. The call does not feed the session's own request prefix, so it does not extend or invalidate the session's reusable prefix.

## Known Limitations and Deferred Work

- **Web surface only** — the hook lives in the Web gateway's `session.prompt` path. Headless, ACP, and SDK entry points create sessions and send first messages outside that path, so auto-detection does not run there.
- **Explicit default is not distinguishable** — a caller that explicitly names the default preset at `session.create` is treated like a default-filled session, so auto-detection still runs. A manual picker choice (an `agent-preset/selected` event) or any other explicit id in the session header suppresses it.
- **Classification cost** — each blank session whose first prompt has text pays one auxiliary model call; deployments may set `provider`/`model` to a cheap route and are responsible for that route being configured on the LLM service.
- **Matching is exact** — the classifier answer must match a roster id byte-for-byte (after stripping backticks and quotes); a hallucinated or renamed id falls back to the default rather than guessing.
