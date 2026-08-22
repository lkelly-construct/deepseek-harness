# @deepseek-ai/dsh-image-router

Image-aware model routing. When a step's request history contains an image, the router rewrites the step's provider/model to a configured image-capable route; the whole turn is served there, then the image is redacted from derived history and the session's base route resumes next turn. It registers no tools and adds no prompt prose.

Routing is presence-based, not "new image" based: a text-only provider rejects any history that still carries an image block, so the router keeps the request on the vision route while any derived message contains an image. The image leaves derived history when this plugin redacts it — at the first step of the *next* turn, after the turn that supplied the image has been served — so the base route resumes instead of the vision route dragging on for the whole session.

## Config

| Key | Required | Meaning |
|---|---:|---|
| `imageProvider` | yes | Registered provider route owning the image-capable model. |
| `imageModel` | yes | Provider-owned model id that declares image input. |

The router listens on the host `agent/request` waterfall as the outermost listener, so it sees the config `installModelSelection` already applied. On an image-bearing step it resolves the configured route and requires it to declare `image` input before routing; a route that does not declare image input, or that is not registered, fails the request loudly rather than dumping an image onto a text-only model. It also listens on `agent/pre-step` and, before a fresh turn's first request whose claimed input carries no image, replaces every image-bearing surface node with an image-free copy.

## Model Experience

### Routing

#### What the model sees

The prompt, schema, and non-image message content are unchanged. On the turn after one that carried an image, each image block in derived history is replaced by the text marker `[image]` and the vision model's description of that image is the adjacent assistant message. The model runs on its session route; the router only selects which provider/model serves a step.

#### Token effect

None beyond the selected provider/model's own usage, plus the redaction shrinks later requests by the bytes of the dropped images.

#### KV Cache effect

Switching provider/model selects a different cache domain for the affected steps; the reusable prefix is otherwise unchanged.

## Known Limitations and Deferred Work

- **Base-route restoration is session-local and in-process** — after a reload mid-image, the router re-detects the image and re-routes; restoration reads `AgentOptions`, which is the route the session was created with, not a later manual picker change that has not been assembled.
- **Manual selection on the vision route is not distinguishable from routing** — a step with no image whose current config equals the image route is restored to the base route, so manually selecting the vision model for non-image work does not persist.
- **The vision route must fit the whole request** — the image-bearing step still sends the complete prior history plus the image to the vision model. If the vision model's context window is smaller than the base model's and the session has grown past it, that step fails with `CONTEXT_WINDOW_EXCEEDED` even though later (redacted) steps would fit. Prefer a vision model whose window is at least the base model's, or compact before pasting images into a long session.
