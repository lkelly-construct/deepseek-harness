# @deepseek-ai/dsh-memory-local

Durable per-workspace persistent memory for the DeepSeek Harness. A session can `save_memory` a fact, and any later session in the same workspace sees it under a `## Persistent memory` section of its system prompt until `forget_memory` removes it. Files are plain markdown under `~/.dsh/memory/<sha256-hash-of-workspace>/`, scoped by workspace so sessions in different workspaces never read each other's memories.

## Usage

Mount as an agent-preset row so the containing agent gets the tools and the prompt section:

```yaml
- id: memory-local
  name: '@deepseek-ai/dsh-memory-local'
```

The plugin injects `tools` and `systemPrompt`. `save_memory(slug, type, content)` writes one `<slug>.md` file; `forget_memory(slug)` removes it.

## Design

The `systemPrompt.section` text callback is synchronous, so memory files are read into an in-memory cache on the first assembly for a workspace and invalidated after a write. There is deliberately no lifecycle-event preload: `agent/created` and `agent/session-start` do not await a returned promise, so an async preload would race the first assembly and the first turn could silently see no memories. Files are a few small markdown files read once per workspace, so synchronous I/O is acceptable here.

## Model Experience

### Persistent memory section

#### What the model sees

For a session whose workspace has saved memories, the system prompt carries a `## Persistent memory` section whose body is the joined content of that workspace's `.md` files. A workspace with no memories contributes no text.

#### Token effect

Conditional: only when the workspace has at least one memory file does the section add tokens, proportional to the memory content.

#### KV Cache effect

Replaceable: a `save_memory` or `forget_memory` that changes the workspace's files invalidates that workspace's cache, so the next request's prompt section replaces the previous one and does not reuse the cached prefix for that section.

### save_memory and forget_memory tools

#### What the model sees

`save_memory` persists one memory for the calling workspace and returns the slug; `forget_memory` removes it and returns the slug. Tool results are short confirmations.

#### Token effect

Zero-direct for the session log beyond the tool call and its confirmation.

#### KV Cache effect

Append-only; writes do not share a stable prefix with later changes to the memory section.

## Known Limitations and Deferred Work

- **A single per-workspace namespace** — memories are keyed only by workspace, with no per-agent scoping or deletion beyond `forget_memory`.
- **No size cap** — a very large memory file is read in full into the prompt; capped summarization is deferred.