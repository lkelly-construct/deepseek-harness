# Agent Note: Auto-detect the agent preset from a blank session's first prompt

Status: implemented

## Problem

A session's composition is chosen by the `agentPreset` session header, the deployment default, or a manual `agentPreset.select` while the session is still blank. A new web session with no explicit pick runs whatever `presets.default` names — a deployment that ships several roles (a benchmark-minimal agent beside a full coding agent) makes the operator or the user pick by hand on every session, and a user who types a task in their own words gets no role match at all.

## Decision

A blank session's first prompt is classified by an auxiliary LLM call against the healthy preset roster, and the chosen preset is composed before the first turn runs. The classifier is the host-plane service `@deepseek-ai/dsh-preset-router` (`presetRouter` on Context), mounted in the web-app composition next to `agent-presets`; the gateway's `session.prompt` handler calls it only when the session is blank, no `agent-preset/selected` event exists, and the session is still on the composed default — so an explicit pick at creation or a manual switch always wins.

The router frames the prompt's text as one JSON `{"request": "…"}` user message, announces every roster id it may pick in the system prompt, and asks for one id back. The answer is parsed leniently: surrounding fences and quotes are stripped, the remaining text must equal one healthy roster id exactly, and `DEFAULT` means "stay". Images are not classified: an image-only first prompt skips routing, and only text parts are framed.

Like every model-visible input, the classifier request is logged before dispatch as a `preset-route/llm-request` session event carrying the exact messages, the route, and the token cap, so the turn is reconstructable from the log alone. The call uses `ctx.llm.stream` with the session-title pattern's `purpose: 'preset-route'`, an event appended first, the caller's current model selection as the fallback route, and an optional `provider`/`model` config override paired as one value.

The whole step is best-effort. A missing router or roster, an empty or broken-only roster, an over-long prompt (`maxInputBytes`), a provider failure, a timeout (`timeoutMs`), or an unparseable answer all keep the session on its current composition and never fail the first message. A successful pick runs the preset-switch path that already exists — `presets.recompose(agentCtx, id)` followed by an `agent-preset/selected` append — so the swap keeps the agent, the session, and every projection, and the dedicated select handler's semantics (blank-only, mount-then-teardown) apply unchanged. A mount failure between classification and swap rolls back to the composition the session started with.

## Alternatives considered

**Prompt the user to pick on the first turn.** The web already has a preset picker RPC; making the first prompt require a choice adds a mandatory interaction to every session in a multi-preset deployment, and the choice only matters when a role actually fits. Skipped.

**Keyword or first-token heuristics without an LLM.** Cheapest option, but a role classifier built from prompt lexemes is exactly the brittle surface the auxiliary call replaces; it would need a new tuning surface and would still fail closed on the same inputs.

**Classify at session creation from request metadata.** Creation carries no task content, only the header, so there is nothing to classify; the first-classification point is the first prompt, which is why the hook lives in `session.prompt`.

## Consequences

**One auxiliary model call per blank first prompt.** It runs on the caller's current route (provider and model the session already selected) unless the composition pins a cheaper pair, adds one round trip plus model latency before the first turn, and its token spend is bounded by `maxInputTokens` (32) on a text-only input capped at `maxInputBytes` (4096). A decline costs a prompt round trip beyond that.

**The classifier only sees text and a roster.** Roster ids are announced verbatim so the answer is a known vocabulary; the framed input carries no session history, workspace state, or model selection beyond what the route field carries.

**Auto-selection is indistinguishable from the default on the surface.** Skipping the call, a `DEFAULT` answer, and a failure all leave the session on the default composition. Only a successful classification is observable — as the recomposed preset and its `agent-preset/selected` event — and a wrongly chosen preset is corrected by an explicit `agentPreset.select` before the session leaves the blank state.

**Web surface only today.** The hook lives in the web gateway's `session.prompt`; headless/CLI sessions and sessions created with an explicit `agentPreset` header bypass it, and `selectionFor(agent).current` supplies the route so the router never decides its own provider in the host composition. The `agent-preset-locked` rule still applies: anything after the first turn is unreachable, so there is no late-swap hazard to audit.

## Testing

Unit tests cover config validation, answer parsing (exact id, `DEFAULT`, fences, unknown ids, garbled text), input gates (image-only, over-long, empty or broken roster), route override, and the never-rejects fallback across provider, timeout, and tool-call finish reasons. A real-composition test boots `Loader` + `AgentPresets` over the shipped fixtures with a stubbed `llm.stream` and asserts classification through the real roster. The gateway integration test stubs `presetRouter` and asserts the full sequence — classify, recompose, `agent-preset/selected` append, then followup — plus the decline and already-selected paths.