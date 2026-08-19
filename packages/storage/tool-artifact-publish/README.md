# @deepseek-ai/dsh-tool-artifact-publish

Artifact publisher tool. Registers `publish_artifact`, which uploads a local file to Supabase Storage and returns a 24-hour presigned download URL. The agent passes an absolute or cwd-relative file path; the plugin handles object naming, upload, and presigning transparently.

Registration is conditional: when `Corax_AI_Supabase_URL` or `Corax_AI_Supabase_Service_Key` is absent the plugin logs a warning and skips registration silently. Uploaded objects are keyed as `<sessionId>/<uuid><ext>` so each artifact is unique and session-isolated.

```ts ignore-check
await ctx.plugin(ToolArtifactPublish)   // @deepseek-ai/dsh-tool-artifact-publish
```

## Deployment requirement: Supabase environment variables

Two environment variables must be present for the tool to register:

| Variable | Purpose |
|---|---|
| `Corax_AI_Supabase_URL` | Supabase project URL (e.g. `https://<ref>.supabase.co`) |
| `Corax_AI_Supabase_Service_Key` | Service-role key — server-side only, never exposed to the browser |

The bucket `dsh-artifacts` must exist in the configured Supabase project with Storage enabled.

## Tools

| Tool | Arguments | Behavior |
|---|---|---|
| `publish_artifact` | `path` (required) | Reads the file at `path` (resolved relative to the session cwd), POSTs it to Supabase Storage with `x-upsert: true`, then requests a signed URL valid for 24 hours. Returns `{ url }` on success; throws on upload or signing failure. |

## Model Experience

### Tool schema

#### What the model sees

`publish_artifact` is described as uploading a local file to shared artifact storage and returning a 24-hour presigned download URL. The description lists example use-cases (reports, images, data exports) and states that the path may be absolute or cwd-relative. The generated [`publish_artifact` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-artifact-publish) is registered only when both required env vars are present at startup.

#### Token effect

Fixed schema cost on every request where the tool is visible. When env vars are absent the tool does not appear and contributes zero schema tokens.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged. The tool appears or disappears at startup based on env vars; changes to the env between restarts may shift the schema prefix.

### Tool results

#### What the model sees

On success the tool returns a single `url` string — the presigned Supabase download link. The `render` function surfaces it as a plain text block. On failure the tool throws an `Error` with a message that includes the HTTP status and response body from Supabase, which surfaces as an `isError` result in the session log.

#### Token effect

One short URL result per successful call; retained in history until compaction. Failed calls add an error message of comparable length.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### No system-prompt contribution

#### What the model sees

This plugin registers no system-prompt section. The `publish_artifact` tool schema description alone is the model's guidance for when and how to call the tool.

#### Token effect

Zero prompt tokens attributable to this plugin beyond the tool schema.

#### KV Cache effect

No prompt-prefix disruption from this plugin.

## Known Limitations and Deferred Work

- **Hardcoded 24-hour artifact TTL** — the presigned URL expires after 86 400 seconds with no configuration knob; long-lived or never-expiring artifacts require a different signing strategy or a public bucket policy.
- **Credentials read directly from `process.env`** — the plugin reads `Corax_AI_Supabase_URL` and `Corax_AI_Supabase_Service_Key` at load time rather than through `ctx.credentials`; rotating secrets requires a process restart, and the service key is not scoped to a session or user.
- **No `presentResult` / replay card** — successful uploads produce a plain URL in the session log; there is no rich card, file-type preview, or replay artifact shown in the harness UI.
- **Error paths may leak response bodies into the session log** — on a failed upload or sign request the full Supabase response body is included in the thrown error message and therefore appears in session history, which may expose internal Supabase error details.
