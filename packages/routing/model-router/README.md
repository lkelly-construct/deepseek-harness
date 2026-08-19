# @deepseek-ai/dsh-model-router

Dynamic per-session model routing. Registers two model-facing tools — `set_model_hint` and `list_model_routes` — that let the model steer its own future steps to a different provider and model without operator involvement.

The plugin mounts an `agent/request` listener on the HOST context, making it the outermost listener in the waterfall. It therefore sees the config that `installModelSelection` already applied and gets the final say. Hints are stored per-session and survive step retries: a `'next'`-scoped hint is bound to the step that first consumes it, so a retry of that step still routes to the requested model rather than silently falling back.

Hint scopes: `'next'` (applies to the next model call only), `'session'` (held for all remaining steps until cleared), and `'clear'` (removes any active hint and restores the default).

```ts ignore-check
await ctx.plugin(ModelRouter)   // @deepseek-ai/dsh-model-router
```

## Deployment requirement: provider registration precedes routing

`set_model_hint` validates the `provider` argument against the live `ctx.llm.listProviders()` roster at call time. An unregistered provider is rejected with an informative error rather than allowed to reach `llm.stream`, where a bad id would fail terminally and end the whole turn. Model ids are not validated — the provider adapter enforces them at stream time.

## Tools

| Tool | Arguments | Behavior |
|---|---|---|
| `list_model_routes` | _(none)_ | Returns one line per registered provider: `<id> (<name>): <model-ids>`. Produces `(model list unavailable)` for adapters that cannot enumerate models. Returns `no provider routes are registered` when the roster is empty. |
| `set_model_hint` | `scope`, `model`, `provider?`, `reasoningEffort?` | Stores a routing hint for the calling session. `scope` is required (`next`, `session`, or `clear`). `model` is required for `next`/`session`. `provider` defaults to the current provider when omitted. Returns a confirmation string or an error message the model can act on. |

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the `## Model routing` guidance section shown below. The guidance appears early in the system prompt (`order: 5`), before most plugin sections.

##### Model routing guidance

```markdown
## Model routing

`set_model_hint` lets you steer future model calls in this session to a different provider or model. Call `list_model_routes` first to see what is registered — never guess a provider or model id.

**Stay on the default model** for mechanical steps: file reads, searches, simple questions, one-liner edits.

**Switch to a more capable model** (scope="session") when the whole task warrants it — planning a non-trivial implementation, debugging a subtle bug, reasoning across many files. Use scope="next" for a single expensive step, then let it revert. Use scope="clear" to restore the default after a heavy-reasoning phase.
```

#### Token effect

Fixed guidance cost per request while the plugin is registered.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. Unloading the plugin or editing the guidance text may invalidate reuse from this prompt section.

### Tool definitions

#### What the model sees

`set_model_hint` describes the three scopes (`next`, `session`, `clear`) and notes that per-tool routing within one agent is not possible and that `list_model_routes` should be called first to obtain valid provider ids. `list_model_routes` describes itself as the source of valid provider ids. Both tools are registered unconditionally when the plugin loads.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged. Registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Tool results

#### What the model sees

`set_model_hint` returns a plain confirmation string (`routing hint set: scope=… provider=… model=… reasoningEffort=…`) or a short error sentence the model can act on without a retry loop. `list_model_routes` returns a newline-delimited provider roster. Neither result enters an `isError` path — user-correctable mistakes (unknown provider, missing model) come back as normal text output.

#### Token effect

One short text result per call; retained in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No per-tool routing** — all model calls within one agent step share a single hint; routing individual tool calls to different models requires delegating to a subagent with its own model assignment.
- **Model ids are not validated at hint-set time** — an invalid model id is stored silently and fails terminally inside `llm.stream` when the routed step runs; only provider ids are validated eagerly.
- **`'next'`-scoped hint persists only for the step that first consumed it** — once a different step runs the hint is cleared, so a model that calls `set_model_hint(scope="next")` and then issues multiple tool calls before the next LLM step will route only the immediately following model request.
- **Session hints are in-process only** — hints live in a plugin-scoped `Map`; a process restart or plugin reload drops all active hints, so a `'session'`-scoped hint set before a restart silently reverts to the default.
