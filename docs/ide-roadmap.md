# Agent Capability Roadmap — Claude Code Parity

Implementation plan for closing the gap between DSH and Claude Code's agent
capabilities. Each feature has a start condition, ordered steps, objective
acceptance criteria, and a stop checkpoint before the next phase begins.

> **Superseded for current priorities.** Active work and its ordering live in
> [docs/improvement-plan.md](improvement-plan.md), which supersedes this document.
> The baseline table below is stale in both directions: it omits shipped work and
> credits five packages (`tool-lsp`, `tool-terminal`, `tool-session-query`,
> `tool-notebook`, `dsh-schedule`) that are present in the repo but not mounted in
> any shipped composition and therefore unreachable at runtime. Use this document
> for historical context and the per-feature engineering specs only.

> **Scope honesty:** this document plans **agent capabilities**, not IDE
> surfaces. DSH's web UI is a chat application (`sidebar | conversation |
> details`). It has no code editor, file tree, file tabs, interactive terminal
> pane, git UI, project search panel, or debugger. See
> [What a real IDE additionally requires](#what-a-real-ide-additionally-requires)
> at the end — the strategy that actually delivers an IDE is T2-1 (attach to
> VS Code), not building editor surfaces in the web app.

> **Verification status:** every API signature, config field, file path, and
> command in this document was verified against source on 2026-08-18. An
> earlier revision contained fabricated APIs (`ctx.agentInstructions`,
> `ctx.subagent.spawn`, `ctx.llm.middleware`, `${ENV}` YAML interpolation,
> `--preset`, per-package `build` scripts). Those are corrected here. If you
> find a claim that does not match source, treat source as authoritative and
> fix this document.

---

## How to use this document

Each feature follows the same structure:

- **Start condition** — what must be true before you touch a line of code.
- **Steps** — the ordered implementation list.
- **Done when** — objective acceptance criteria (all must pass).
- **Stop checkpoint** — what to verify and commit before moving on.

Work features in tier order. Do not begin a Tier 2 feature until all Tier 1
features have passed their stop checkpoints.

---

## Repo conventions you must know first

These apply to every feature below. Getting them wrong wastes a full cycle.

### Commands (root-only — packages have no `build` script)

```bash
npm run build          # build:lib (host + client) then build:web
npm run typecheck      # builds host libs, then tsc -b tsconfig.client.json
npm run lint           # oxlint
npm run test           # vitest run
pnpm run constraints   # package.json invariants
pnpm run doc-sync      # regenerate all generated catalogs
pnpm run hygiene       # rescope check + knip + publint + constraints
```

`pnpm --filter <pkg> build` is **not** valid — packages under `packages/`
carry no `scripts` block. Building is orchestrated at the root via TypeScript
project references (`tsc -b`).

### Adding a new package (see `docs/cookbook/adding-a-package.md`)

Auto-discovered by glob (no edit needed): `pnpm-workspace.yaml` (`packages/*/*`),
root `package.json` workspaces, `tsdown.config.ts`, `.oxlintrc.json`.

**Manual and mandatory:**

1. `tsconfig.host.json` (or `tsconfig.client.json` for a client package) — add
   `{ "path": "./packages/<group>/<pkg>" }` to `references`. Project references
   have **no glob form**. A package belongs to exactly one aggregate.
2. If the group is **new** (e.g. `packages/memory/`), also add two wildcard
   entries to `tsconfig.base.json`: `./packages/<group>/*/src` and
   `./packages/<group>/*/src/invariant.ts`.
3. `package.json` must satisfy `pnpm run constraints`: `private: true`,
   `version` matching root (`0.1.0-rc.7`), `type: module`,
   `main: "lib/index.js"`, `types: "lib/types/index.d.ts"`, exact `exports["."]`,
   `@deepseek-ai/cordis` in **both** `peerDependencies` and `devDependencies` at
   the same range, every dsh peer mirrored in devDependencies, and a `files`
   list of exactly `lib/index.js`, `lib/invariant.js`, `lib/types/**/*.d.ts`.
4. `tsconfig.json` extending `../../../tsconfig.base.json`, `rootDir: src`,
   `outDir: lib/types`, with `references` to `vendor/cosmokit`, `vendor/cordis`
   (+ `@deepseek-ai/schemastery` if using `Config`, + each dsh dep).
5. `README.md` with the gated `## Model Experience` section (three ordered H4s)
   and `## Known Limitations and Deferred Work`, or an allowlist entry in
   `scripts/verify-package-readme-*.ts`.
6. In-package relative imports use explicit `.ts` specifiers.
7. Run `pnpm run doc-sync` — generated catalogs scan `packages/*/*/src/**/*.ts`
   and `scripts/gen-cordis-catalog.ts` **fails loud** on a new `ctx.<key>` its
   curated maps don't cover.

Verify sequence: `pnpm install` → `pnpm run doc-sync` →
`pnpm run constraints && npm run typecheck && npm run lint` →
`npm run build && pnpm run hygiene`.

Naming rule from the cookbook: use `-local` in a package name **only** when
same-host execution is part of the contract.

### Secrets and env vars in preset YAML

There is **no `${VAR}` interpolation**. The YAML dialect registers exactly one
custom tag, `!!js`, evaluated by the loader against the row's own context with
`process` reachable on the global scope:

```yaml
env:
  GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN
headers:
  Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

`${...}` **does** work *inside* a `!!js` expression — it's a JS template
literal at that point, not YAML. Quote any expression containing `?` or `:` or
YAML parses it as a mapping. `!!js` is interpolated in plugin `config` and in
the `disabled` field only; `id`, `name`, `group`, and `inject` are static
(enforced by `scripts/verify-cordis-config.ts`).

### Contributing text to the system prompt

The service is **`ctx.systemPrompt`** (`packages/core/system-prompt/src/`).

```ts
section(section: PromptSection): () => void   // stable cache prefix
context(context: PromptContext): () => void   // churning per-session snapshot
variable(name: string, provider: (c: AssembleContext) => string | undefined): () => void
tools(provider: (c: AssembleContext) => ToolProviderResult): () => void
```

```ts
export interface PromptSection {
  readonly name: string        // NOT `id`
  readonly order: number       // NOT `priority`; ASCENDING (lower = earlier)
  readonly text: string | ((context: AssembleContext) => string)
  readonly complete?: boolean
}
```

Order conventions from source: `-100` harness identity, `0` deployment persona
(`PERSONA_ORDER`), `100–199` tool guidance. Non-finite `order` throws; a
duplicate `name` in the same layer throws.

Per-session data reaches a callback through `AssembleContext`, which
`@deepseek-ai/dsh-agent` augments with `agent?: Agent`:

```ts
text: (context) => {
  if (context.agent === undefined) return ''      // diagnostics assembly
  const cwd = context.agent.session.header.cwd ?? process.cwd()
  return renderFor(cwd)
}
```

**The callback is synchronous** — you cannot `await` inside it. Async data must
be preloaded into a cache (see T1-4).

The working reference is `packages/preset/persona/src/index.ts` (68 lines):
`inject = ['systemPrompt']`, and the call wrapped in
`ctx.effect(() => ctx.systemPrompt.section({...}), 'persona.section()')` so
disposal follows the plugin fiber.

`section` vs `context`: sections are the stable, cacheable prefix. `context()`
materializes as a durable **user-role** snapshot message that supersedes the
previous one — use it for values that churn, so you don't invalidate the
provider's KV cache prefix on every change. Real examples:
`packages/interaction/user-approval/src/index.ts:204`,
`packages/sandbox/sandbox-policy/src/index.ts:113`.

### How a preset gets selected (there is no `--preset` flag)

CLI root flags are `--profile <name>`, `--patch <path>`, `--dump-config`,
`--dump-default-config`, `-V`. Preset selection has three real mechanisms:

1. Composition default — the `agent-presets` plugin's own `default` config field.
2. User default — settings namespace `agent-presets`, field `default`.
3. Per-session UI picker — RPC `agentPreset.select({ sessionId, agentPreset })`,
   allowed **only while the session is blank** (after a turn it answers
   `agent-preset-locked`). `session.create` also accepts `agentPreset`.

---

## Baseline — Already Shipped (no work needed)

| Capability | Package |
|---|---|
| File read / write / edit / read_image | `packages/fs/tool-fs` |
| Glob + ripgrep search | `packages/fs/tool-fs-search` |
| `str_replace_editor` (Claude-compatible) | `packages/fs/tool-str-replace-editor` |
| Bash execution | `packages/shell/tool-bash` |
| PowerShell execution (Windows) | `packages/shell/tool-pwsh` |
| Persistent PTY terminals (6 model-facing tools) | `packages/terminal/tool-terminal` |
| Web search + fetch | `packages/web/tool-web` |
| MCP client (stdio + streamable-http) | `packages/mcp/mcp-client` |
| Subagents (spawn / fork / ACP / Codex / Claude Code / SDK) | `packages/subagent` |
| Todo list | `packages/todo/tool-todo` |
| Goals | `packages/goal` |
| Plan mode | `packages/plan/plan-mode` |
| Claude Code-compatible hooks | `packages/hooks/hooks-claude-code` |
| Context compaction + tool-result pruning | `packages/compaction` |
| Session persistence (JSONL + SQLite) | `packages/session` |
| Session search (FTS) | `packages/session-query` |
| **Session archive (full UI + 11-file call chain)** | `packages/workspace` + `ui-workspace` |
| Skills | `packages/skill` |
| Workflow orchestration | `packages/workflow` |
| Background jobs | `packages/jobs/tool-jobs` |
| **Durable scheduled reminders (`every_seconds`, min 5 min)** | `packages/schedule/schedule` |
| TypeScript code runtime | `packages/code-runtime` |
| E2B cloud sandbox | `packages/e2b` |
| LSP integration | `packages/lsp` |
| Static HTML preview card | `packages/client/ui-primitives` |
| Live app preview card | `packages/examples/tool-app-preview` |
| Per-agent model selection | `packages/core/agent/src/model-selection.ts` |

---

## Tier 1 — Needs

### T1-1 · Wire `render_app_url` into the Standard Preset

**Effort:** 30 minutes

#### Start condition
- `render_app_url` is not currently listed in
  `apps/cli/config/agent-presets/standard/agent.cordis.yml`.

#### Steps

1. In `apps/cli/config/agent-presets/standard/agent.cordis.yml`, after the last
   shell tool row, add:

   ```yaml
   - id: tool-app-preview
     name: '@deepseek-ai/dsh-tool-app-preview'
   ```

2. Repeat in `apps/cli/config/agent-presets/code/agent.cordis.yml`.

3. Do **not** add it to `minimal/agent.cordis.yml` — intentionally stripped down.

#### Done when
- [ ] `render_app_url` appears in the tool list for a `standard` session.
- [ ] Agent starts a dev server via bash, calls `render_app_url` with the
      localhost URL, and the chat renders the iframe card.
- [ ] `npm run typecheck` passes.

#### Stop checkpoint
Commit: `feat(preset): T1-1 mount render_app_url in standard and code presets`

---

### T1-2 · Supabase MCP Preset

**Effort:** 1 hour (config only)

#### Start condition
- T1-1 committed.
- You have a Supabase personal access token.

#### The real `mcp-client` config schema

Discriminated union on `transport`. Verified fields:

```
transport: 'stdio'                    transport: 'streamable-http'
serverName: string (required)         serverName: string (required)
command: string (required)            url: string (required)
args: string[] = []                   headers: Record<string,string> = {}
env: Record<string,string> = {}       toolCallTimeoutMs: number = 60000
cwd: string = ''                      failOnStartupError: boolean = false
toolCallTimeoutMs: number = 60000     reconnect: {...}
failOnStartupError: boolean = false
reconnect: {...}
```

`reconnect` defaults: `enabled: true`, `initialDelayMs: 500`,
`maxDelayMs: 30000`, `maxAttempts: 10`. `initialDelayMs` must be
`<= maxDelayMs` or the plugin throws at load. `serverName` must match
`^[A-Za-z0-9_-]{1,32}$`; a duplicate `serverName` fails the later instance.

Tools register as `mcp__<serverName>__<rawToolName>`.

#### Steps

1. Create `apps/cli/config/agent-presets/supabase/agent.cordis.yml`. Pass the
   token via the `env` field (preferred — keeps it off the process argv) using
   `!!js`, **not** `${...}`:

   ```yaml
   # Supabase agent preset — standard tools + Supabase MCP.
   # Requires SUPABASE_ACCESS_TOKEN in the environment.

   - id: tool-app-preview
     name: '@deepseek-ai/dsh-tool-app-preview'

   - id: supabase-mcp
     name: '@deepseek-ai/dsh-mcp-client'
     config:
       transport: stdio
       serverName: supabase
       command: npx
       args:
         - -y
         - '@supabase/mcp-server-supabase@latest'
       env:
         SUPABASE_ACCESS_TOKEN: !!js process.env.SUPABASE_ACCESS_TOKEN
       failOnStartupError: false
       reconnect:
         enabled: true
         initialDelayMs: 1000
         maxDelayMs: 30000
         maxAttempts: 5
   ```

   If the Supabase server only accepts the token as a CLI flag rather than an
   env var, use `- !!js process.env.SUPABASE_ACCESS_TOKEN` as an `args` entry —
   check the server's own docs first.

2. Create `apps/cli/config/agent-presets/supabase/README.md` documenting the
   env var and stating that the preset is selected via the UI picker on a blank
   session or by setting the `agent-presets` settings namespace `default` field
   — **not** a CLI flag.

#### Done when
- [ ] With `SUPABASE_ACCESS_TOKEN` exported, selecting the `supabase` preset on
      a blank session lists `mcp__supabase__*` tools.
- [ ] `mcp__supabase__list_tables` returns real data.
- [ ] With the env var **unset**, the harness still starts (a warning, not a
      crash — this is what `failOnStartupError: false` buys).

#### Stop checkpoint
Commit: `feat(preset): T1-2 add supabase MCP preset`

---

### T1-3 · Windows PowerShell Parity

**Effort:** audit complete — no code changes required

> **Audited 2026-08-18 on Windows.** All four original steps were verified
> against source. Three were already done; one step in the original spec was
> based on a false premise and is corrected below.

#### Start condition
- T1-2 committed. You are on Windows and can reproduce the failures.

#### Audit findings (verified 2026-08-18)

1. **Bash idioms in prompt text — no changes needed.**
   `standard`, `code`, and `@deepseek-ai/cordis` presets correctly disable `tool-bash` on
   Windows (`disabled: !!js process.platform === 'win32'`) and enable `tool-pwsh`.
   Persona text is platform-agnostic. The `tool:bash` system-prompt section only
   registers when the plugin is loaded (not on Windows). The `tool:pwsh` section
   provides PowerShell-specific guidance. No bash idioms appear in any
   unconditional prose the model sees on Windows.

2. **Ripgrep resolution on Windows — already works.**
   `packages/fs/tool-fs-search/src/grep.ts` uses `runRipgrep` which resolves the
   binary via `@vscode/ripgrep`, a package that ships the platform binary as an
   optional dependency (`@vscode/ripgrep-win32-x64-msvc` etc.) and exports an
   absolute `rgPath`. `rg.exe` is found correctly on Windows. No fix needed.

3. **Sandbox on Windows — original spec was wrong; do not add the warning.**
   The original step said "confinement is unavailable on Windows" and proposed
   adding an "unconfined" warning. **This is incorrect.** `packages/sandbox/sandbox-local`
   already handles Windows via a `windows-acl` runner chain (`win32: ['windows-acl']`
   in `PLATFORM_CHAINS`), backed by `@deepseek-ai/dsh-sandbox-windows-acl`. This
   creates a restricted-token process with DACL-scoped write grants. Enforcement is
   `partial` (not `full`) because NTFS hard links and paths granted to Everyone
   bypass the restriction — documented in `STATIC_ENFORCEMENT` and the
   `sandbox-windows-acl` README. Adding an "unavailable / unconfined" warning
   would be factually wrong and mislead the user.

4. **Tool-pwsh tests — already comprehensive.**
   `packages/shell/tool-pwsh/tests/tools.spec.ts` (1056 lines) covers stdout
   capture, timeout, exit-code propagation, abort signals, background jobs, sandbox
   denial rendering, and UI presenters over a fake executor. Real-process behavior
   is pinned in `integration.spec.ts` and `packages/shell/pwsh-local/tests/executor.spec.ts`
   (499 lines) with `describe.skipIf(!hasPwsh)` guards. Parity with `tool-bash`
   semantics is structurally guaranteed: the two packages share the same render and
   background modules. No new test needed.

#### Done when
- [x] On Windows with the `standard` preset the agent emits PowerShell (not
      bash) commands and `tool-fs-search` grep works (confirmed — no changes needed).
- [x] Sandbox runs with `windows-acl` partial enforcement, not unconfined
      (confirmed — no warning needed; the original claim was wrong).
- [x] `npm run test` passes (existing test suite covers all seams).

#### Stop checkpoint
Commit: `fix(shell): T1-3 Windows PowerShell parity`

---

### T1-4 · Cross-Session Persistent Memory

**Effort:** 2–3 days

#### Start condition
- T1-3 committed.
- You have read the "Contributing text to the system prompt" section above and
  `packages/preset/persona/src/index.ts`.

#### Design constraints (these drive the implementation)

- The `systemPrompt.section` text callback is **synchronous**. You cannot
  `await` inside it.
- Per-session cwd comes from `context.agent.session.header.cwd`.
- **Do not preload from a lifecycle event.** `agent/created` and
  `agent/session-start` are both `@mode emit` and neither awaits a returned
  promise (`agent/created`'s JSDoc: a returned-promise rejection is merely
  "reported"). A fire-and-forget async preload races the first assembly, so the
  first turn silently sees no memories. Instead read **synchronously** inside
  the section callback, cached per cwd and invalidated after a write. Memory
  files are a few small markdown files read once per workspace.
- Consider `ctx.storage` (`packages/storage/storage-json`) instead of raw `fs`;
  read that package's API before deciding. Raw `fs` under `~/.dsh/memory/` is
  the simpler path and is specified below.

#### Steps

1. Create `packages/memory/memory-local/` following the new-package checklist
   above. This is a **new group**, so `tsconfig.base.json` needs both wildcard
   entries plus a `tsconfig.host.json` project reference.

2. `src/store.ts` — file I/O, scoped by workspace path hash:

   ```ts
   import { createHash } from 'node:crypto'
   import { readdirSync, readFileSync } from 'node:fs'
   import { mkdir, unlink, writeFile } from 'node:fs/promises'
   import { homedir } from 'node:os'
   import { join } from 'node:path'

   /** Per-workspace memory directory under the harness home. */
   export function memoryDir(workspacePath: string): string {
     const hash = createHash('sha256').update(workspacePath).digest('hex').slice(0, 16)
     return join(homedir(), '.dsh', 'memory', hash)
   }

   /**
    * Read every memory file for one workspace; a missing directory yields [].
    * Synchronous by design: the only caller is the synchronous system-prompt
    * section callback, and an async read there would race the first assembly.
    * The payload is a few small markdown files, read once per workspace.
    */
   export function readMemories(workspacePath: string): string[] {
     try {
       const dir = memoryDir(workspacePath)
       return readdirSync(dir)
         .filter(name => name.endsWith('.md'))
         .map(name => readFileSync(join(dir, name), 'utf8'))
     } catch {
       return []
     }
   }

   /** Write one memory file, creating the workspace directory on demand. */
   export async function writeMemory(
     workspacePath: string, slug: string, type: string, content: string,
   ): Promise<void> {
     const dir = memoryDir(workspacePath)
     await mkdir(dir, { recursive: true })
     const front = `---\nname: ${slug}\ntype: ${type}\n---\n\n`
     await writeFile(join(dir, `${slug}.md`), `${front}${content}\n`, 'utf8')
   }

   /** Delete one memory file; returns false when it was already absent. */
   export async function deleteMemory(workspacePath: string, slug: string): Promise<boolean> {
     try {
       await unlink(join(memoryDir(workspacePath), `${slug}.md`))
       return true
     } catch {
       return false
     }
   }
   ```

3. `src/index.ts` — plugin entry. Note `inject = ['tools', 'systemPrompt']` and
   that the cache is filled lazily *inside* the synchronous callback, so there
   is no lifecycle listener and no race:

   ```ts
   import type { Context } from '@deepseek-ai/cordis'
   import type {} from '@deepseek-ai/dsh-system-prompt'
   import { readMemories } from './store.ts'
   import { registerMemoryTools } from './tools.ts'

   export const name = 'memory-local'
   export const inject = ['tools', 'systemPrompt']

   export function apply(ctx: Context): void {
     // Rendered memory text per workspace path. Filled on first assembly for a
     // workspace and invalidated after a write, so a turn never reads stale
     // text and never waits on I/O it cannot await.
     const cache = new Map<string, string>()

     const render = (cwd: string): string => {
       const cached = cache.get(cwd)
       if (cached !== undefined) return cached
       const memories = readMemories(cwd)
       const text = memories.length === 0
         ? ''
         : `## Persistent memory\n\n${memories.join('\n\n---\n\n')}`
       cache.set(cwd, text)
       return text
     }

     ctx.effect(() => ctx.systemPrompt.section({
       name: 'memory:workspace',
       order: 10,
       text: (context) => {
         // Absent agent means a diagnostics assembly with no session to scope to.
         if (context.agent === undefined) return ''
         return render(context.agent.session.header.cwd ?? process.cwd())
       },
     }), 'memory.section()')

     // Tools invalidate the cache entry for the workspace they wrote to.
     registerMemoryTools(ctx, (cwd: string) => cache.delete(cwd))
   }
   ```

   Do not reintroduce a lifecycle-event preload. `agent/created` is
   `payload: { agent: Agent }` (not a bare `Agent`) and is documented
   composition-only; neither it nor `agent/session-start` awaits a returned
   promise, so an async preload from either one races the first assembly.

4. `src/tools.ts` — `save_memory` and `forget_memory` via `defineTool`. Each
   resolves the workspace from `exec` (see `packages/fs/tool-fs/src/session-cwd.ts`
   for the established `sessionCwd(exec, path)` helper) and calls the
   `invalidate(cwd)` callback after a write or delete, so the next assembly
   re-reads that workspace's files.

5. Mount in `apps/cli/config/agent-presets/standard/agent.cordis.yml`:

   ```yaml
   - id: memory-local
     name: '@deepseek-ai/dsh-memory-local'
   ```

#### Done when
- [x] `save_memory` in session A → the fact appears in the system prompt of a
      fresh session B in the same workspace.
- [x] `forget_memory` removes it; session C no longer sees it.
- [x] Files are readable markdown under `~/.dsh/memory/<hash>/`.
- [x] A session in a **different** workspace does not see the first
      workspace's memories.
- [x] `pnpm run doc-sync` regenerates cleanly (no uncovered `ctx.<key>`).
- [x] `pnpm run constraints && npm run typecheck && npm run lint && npm run test` pass.

#### Stop checkpoint
Commit: `feat(memory): T1-4 add memory-local with save_memory and forget_memory`

---

### T1-5 · True Session Deletion

**Effort:** 1–2 days

#### Start condition
- T1-4 committed.
- **Read this first:** session *archive* already ships end to end. Confirm that
  a true delete is actually what you want, because archive already hides the
  session from every grouping surface while keeping the log.

#### What already exists (mirror this, don't invent)

Archive's full call chain — a delete follows the same 11 hops:

```
packages/client/ui-workspace/src/client/rows/Rows.tsx          menu item + dispatch
packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx   handler
packages/client/ui-workspace/src/client/index.ts               slot impl
packages/client/ui-workspace/src/client/contract/slots.ts      slot type
packages/client/runtime/src/client/workspaces/service.ts
packages/client/runtime/src/client/workspaces/manager.ts       calls api.workspace.*
packages/client/runtime/src/client/contract/workspaces.ts
packages/host/apiproxy/src/api/workspace.ts                    interface + docs
packages/host/apiproxy/src/api/workspace.schema.ts             zod request/response
packages/host/apiproxy/src/api/rpc-map.ts                      wire registration
packages/host/apiproxy/src/api-proxy.ts                        host handler
packages/client/connection/src/client/fixture.ts               test fixture (must implement)
```

The wire layer is **not REST**. `packages/api/gateway` is Typert RPC with a
hard two-segment `namespace/method` check — `DELETE /sessions/:id` is
structurally impossible there. The web UI's session operations go through
`packages/host/apiproxy`, a dotted-method map (`POST /api/workspace.archiveSession`).
Add `workspace.deleteSession` (or `session.delete`) to `rpc-map.ts`.

`WorkspaceBrowser.tsx` **already has** a delete-confirmation dialog — for
workspaces (`onDeleteRequest`, `deleteTarget`/`deleting`/`deleteError`). Mirror
that pattern; do not build a new dialog.

#### The backend contract problem

`packages/session/session-persistence/src/index.ts` declares
`abstract class SessionPersistence extends Service` with 8 abstract methods plus
`abstract readonly supportsRawArtifacts: boolean`. Its own doc says
**"Durable append-only session storage."**

Adding an abstract member is a **breaking change to every implementor**:
`session-persistence-jsonl`, `session-persistence-sqlite`, plus test doubles and
`packages/client/connection/src/client/fixture.ts`. Deleting a whole log is
defensible (removing the log entirely, not mutating events), but state that
reasoning in the JSDoc.

House style for the new member — `id` first, optional `signal` last, full JSDoc:

```ts
/**
 * Remove one session's durable log entirely.
 * @param id - session to remove.
 * @param signal - optional cancellation for the underlying I/O.
 * @throws When the backend cannot remove the log.
 */
abstract delete(id: SessionId, signal?: AbortSignal): Promise<void>
```

There is **no existing public delete anywhere** in `packages/session` or
`packages/session-query` (the `_deleteSession` in `session-query-sqlite` is
private search-index reconciliation only, and cannot remove the underlying log).

#### Steps

1. Add `abstract delete(...)` to `SessionPersistence`.
2. Implement in JSONL (`unlink` the session file) and SQLite
   (`DELETE FROM events WHERE session_id = ?` then
   `DELETE FROM sessions WHERE id = ?`).
3. Update every test double and `packages/client/connection/src/client/fixture.ts`.
4. Guard the active session — refuse with a typed error, mirroring how archive
   rejects `session-not-found`.
5. Wire the apiproxy hop: interface + zod schemas + `rpc-map.ts` + handler.
6. UI: menu item in `rows/Rows.tsx`, handler in `WorkspaceBrowser.tsx` reusing
   the existing confirmation dialog, locale strings in `locales.ts`.
7. Ensure `session-query` drops the session from its index (it already prunes
   sessions that disappear from persistence — verify this path fires).

#### Done when
- [x] Session row context menu offers Delete alongside Archive.
- [x] Confirming removes the row, and the JSONL file is gone from disk.
- [x] Deleting the active session is rejected with a visible error.
- [x] Deleted sessions do not appear in session search.
- [x] `npm run test` passes, including the connection fixture.

#### Stop checkpoint
Commit: `feat(session): T1-5 add durable session delete with UI`
**Tier 1 complete.** Run `pnpm run hygiene && npm run test` before Tier 2.

---

## Tier 2 — Wants

### T2-1 · VS Code Extension  ← the actual IDE strategy

**Effort:** 5–10 days

This is the item that makes DSH feel like an IDE, by attaching to one instead of
rebuilding one. It inherits editor, file tree, tabs, integrated terminal, git UI,
and debugger — every surface the web UI lacks.

#### Start condition
- All Tier 1 stop checkpoints green.
- You have read `packages/sdk/protocol/src/`, `packages/sdk/client/src/`, and
  `packages/sdk/server/src/server.ts` (which calls `ctx.agents.create` at
  line ~223 — the reference for driving a session out of process).

#### Steps

1. Scaffold `apps/vscode/` (extension manifest, `engines.vscode`).
2. `DshSession.ts` — spawn the SDK server as a child process and drive it with
   `packages/sdk/client`. One session per chat pane.
3. `ChatPanel.ts` — a `WebviewPanel`. The existing web UI assets can be served
   locally and loaded in the webview, so no second chat UI is needed.
4. `fileDiff.ts` — intercept `edit` tool results and surface them via
   `vscode.commands.executeCommand('vscode.diff', ...)` for review before apply.
5. File links — `ToolRow` already accepts an `onOpenFile` prop. Route it through
   the webview message channel to `vscode.workspace.openTextDocument` +
   `showTextDocument` at the right line. Note the *web* host implements
   `openPath` by shelling out to the OS default app
   (`packages/host/apiproxy/src/api-proxy.ts:1867`); the extension should
   override that with in-editor navigation.

#### Done when
- [x] A command opens a working chat pane; the agent responds.
- [x] Agent reads/writes/edits files in the open workspace.
- [x] File paths in tool rows jump the editor to the correct line.
- [x] Proposed edits open in the VS Code diff editor before applying.
- [x] Extension activates cleanly on a fresh VS Code install.

#### Stop checkpoint
Commit: `feat(vscode): T2-1 initial extension — chat pane, diffs, path links`
Have a second person install the VSIX and complete one task before T2-2.

---

### T2-2 · Autonomous Scheduled Sessions

**Effort:** 2–4 days (smaller than originally scoped)

#### Start condition
- T2-1 committed, or explicitly deferred with T1-5 green.
- You have read `packages/schedule/schedule/` **in full**.

#### Why this is smaller than it looks

`packages/schedule/schedule` already implements durable scheduling: tools
`schedule_create` / `schedule_list` / `schedule_delete`, one-shot plus
`after_seconds` and `every_seconds` recurrence, persisted in the session event
log, minimum interval 5 minutes (`MIN_EVERY_INTERVAL_SECONDS`).

Its limitation is **delivery mode only**: the README states
`deliveryMode: "session-local"` — it wakes the *same* agent via `followup()`.
The work is adding a delivery mode that starts a **fresh** session.

#### The correct spawn API

`ctx.subagents` **cannot** do this. Both `start(name, request)` and
`startContinuable(spec)` require `parent: Agent`, and there is no `preset` or
`initialTurn` field anywhere in `SubagentStartRequest`.

Use `ctx.agents.create` (`packages/core/agent/src/index.ts:405`):

```ts
async create(options: CreateAgentOptions): Promise<AgentHandle>

export interface CreateAgentOptions {
  readonly sessionId: SessionId
  readonly meta?: {
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly seedLength?: number
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string      // ← preset selection lives here
  }
  readonly seed?: readonly SessionEvent[]
  readonly agentOptions?: AgentOptions
  readonly signal?: AbortSignal
  readonly setup?: AgentSetup
}
```

Omit `meta.parentSession` and `meta.origin` to get a **root** session. Working
reference for create-then-first-turn:
`packages/bundle/headless/src/index.ts:111-125` — `agents.create({...})` →
`await agent.whenIdle()` → `agent.followup(createUserMessage({ content, source: { kind: 'user' } }))`.

You must mint the `sessionId` yourself; find how `api-proxy.ts` does it for a
new chat and reuse that.

#### Steps

1. Extend the schedule config with a delivery mode (e.g.
   `deliveryMode: 'session-local' | 'new-session'`), defaulting to the current
   behaviour so nothing regresses.
2. For `new-session`, resolve `cwd` and `agentPreset` from the scheduling
   session, mint a session id, `ctx.agents.create(...)`, then `followup(...)`
   with the stored prompt.
3. Persist the delivery mode alongside the existing schedule record.
4. Tag the spawned session so it is identifiable in the sidebar.
5. Do **not** put the timer in `packages/boot/app-boot` — that is Loader boot
   glue and owns no agent or session. `packages/schedule/schedule` already owns
   the correct per-owner timer runtime disposed by `ctx.effect`.

#### Done when
- [x] A `new-session` schedule with a 5-minute interval starts a fresh root
      session on each fire.
- [x] `schedule_list` reports it with the next fire time.
- [x] Schedules survive a harness restart.
- [x] The existing `session-local` mode is unchanged (regression test).

#### Stop checkpoint
Commit: `feat(schedule): T2-2 add new-session delivery mode`
Soak test one interval cycle before continuing.

---

### T2-3 · Artifact Publishing

**Effort:** 2–3 days

#### Start condition
- T2-2 committed or deferred. You have an S3-compatible bucket.
- **Security review required before starting** — this feature makes content
  publicly reachable and handles cloud credentials. Decide deliberately: bucket
  scoping, whether URLs are guessable, object TTL, and whether the model may
  publish without user confirmation.

#### Steps

1. Create `packages/storage/tool-artifact-publish/` (existing `storage` group →
   only a host project reference needed; no `tsconfig.base.json` edit).
   Note: `packages/artifact/artifact-s3/` does not exist; shipped implementation
   uses Supabase Storage + Vercel env pull (`packages/storage/tool-artifact-publish/`).
2. Credentials via `ctx.credentials`, **never** in a settings file or preset YAML.
3. `publish_artifact` tool returning a new card type.
4. Add `ArtifactResultView` to the `ToolResultView` union in
   `packages/core/tools/src/presentation.ts` (this is where
   `AppPreviewResultView` lives — follow it exactly).
5. `ArtifactBlock.tsx` in `packages/client/ui-primitives/src/`, mirroring
   `AppPreviewBlock`, wired into the card chain in
   `packages/client/ui-tool/src/client/tool/components/ToolRow.tsx`.
6. Store the URL in `presentationMeta` so replay rebuilds the card.

#### Done when
- [x] Publishing returns a card with a reachable HTTPS URL.
- [x] TTL expiry works as configured.
- [x] The card survives session replay.
- [x] No credential value appears in any settings file, preset, or session log.

#### Stop checkpoint
Commit: `feat(artifact): T2-3 add artifact-s3 and ArtifactBlock card`

---

### T2-4 · Jupyter Notebook Editing

**Effort:** 2 days — skip unless you have a notebook workflow.

#### Start condition
- T2-3 committed or deferred.

#### Steps

1. Create `packages/fs/tool-notebook/` (existing group — only a host project
   reference needed, no `tsconfig.base.json` edit).
2. `.ipynb` is JSON; read/modify/write via `ctx.fs`. No library needed.
3. One `notebook_edit` tool with commands `read` / `insert` / `replace` /
   `delete`, indexed by cell.
4. Optional `run` via `jupyter nbconvert --to notebook --execute --inplace`
   through `ctx.shell`.

#### Done when
- [x] All four commands round-trip correctly on a real `.ipynb`.
- [x] Malformed JSON produces a clear tool error, not a crash.

#### Stop checkpoint
Commit: `feat(fs): T2-4 add tool-notebook`

---

## Tier 3 — Stretch

### T3-1 · Browser Automation via Playwright MCP

**Effort:** 1 hour (config only — no token, so no `!!js` needed)

```yaml
# apps/cli/config/agent-presets/browser/agent.cordis.yml
- id: tool-app-preview
  name: '@deepseek-ai/dsh-tool-app-preview'

- id: playwright-mcp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    transport: stdio
    serverName: playwright
    command: npx
    args:
      - -y
      - '@playwright/mcp@latest'
    failOnStartupError: false
```

#### Done when
- [ ] `mcp__playwright__*` tools appear and a navigate call returns page content.

#### Stop checkpoint
Commit: `feat(preset): T3-1 add browser preset with Playwright MCP`

---

### T3-2 · Multi-Model Routing  ⚠ needs design work, not just code

**Effort:** 1 week+ — **do not delegate this; it is a design problem.**

#### Why the obvious approach doesn't work

There is no `ctx.llm.middleware`. The real per-request seam is the
`agent/request` waterfall (`packages/core/agent/src/runtime-types.ts:244`):

```ts
'agent/request'(this: Scoped<Agent>, payload: {
  agent: Agent; turn: number; step: number; signal: AbortSignal
}, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>
```

Three constraints that shape any design:

1. **Ordering in the waterfall matters.** `installModelSelection`
   (`packages/core/agent/src/model-selection.ts`) registers an `agent/request`
   listener on the agent-scoped context at agent creation time. A router
   plugin registered on the HOST context registers its listener BEFORE any agent
   is created, making it the outermost wrapper in the Cordis waterfall. The
   outermost listener calls `await next()` (which runs `installModelSelection`),
   receives the model-selection-applied config, and can then override it. This
   ordering works correctly — the router gets the final say, not `installModelSelection`.
   The original claim that "a router registered beneath it gets clobbered" was
   based on confusing host-plane registration order with agent-scoped registration
   order.
2. **`prepareCall` cannot be used to swap models late.** It validates the config
   and `stream()` throws `INVALID_PREPARED_CALL` if the dispatched options
   don't equal the resolved config. The router must produce its final config
   INSIDE the `agent/request` waterfall, not after `prepareCall`.
3. **`llm/stream` is the wrong layer.** Rewriting there desyncs the logged
   `request/header` / `request/context` events the loop appends from the
   pre-dispatch config, violating the repo's model-visible ⟺ logged rule.

Also: **per-tool model switching does not exist anywhere.** What exists is
per-agent (subagent `agentOptions`, interactive `selectModel`) and
per-auxiliary-call-site, where compaction
(`packages/compaction/compaction-basic/src/summarizer.ts`) and title generation
(`packages/session/session-title-llm/src/index.ts`) bypass the loop entirely and
build their own `LlmCallConfig` for `ctx.llm.stream()`.

#### Viable design path (per-step routing)

A host-plane router plugin CAN be implemented:

```ts
// packages/routing/model-router/src/index.ts
export const name = 'model-router'
export const inject = ['llm']  // ensure provider is registered

export function apply(ctx: Context): void {
  // Registered on host context = outermost in agent/request waterfall.
  // installModelSelection registers at agent creation (later) so it is inner.
  ctx.on('agent/request', async ({ turn, step }, next) => {
    const config = await next()  // gets installModelSelection's choice
    // Example: use a lighter model on step 0 for planning, heavier for later steps
    if (step === 0 && turn > 0) {
      return { ...config, provider: 'openrouter', model: 'anthropic/claude-haiku-4-5' }
    }
    return config
  })
}
```

The routing policy can key on `{ turn, step }` from the payload and any
session-level state the plugin tracks. The selected provider must be registered
with `ctx.llm` before the waterfall fires.

**Per-tool routing is not possible within a single agent session** — at
`agent/request` time, the model has not yet been called, so there is no tool
call to key on. Route tool-specific tasks to a specialized subagent instead,
which already works via `tool-subagent` with `agentOptions.model`.

#### Answer the design question before starting

Decide: static policy (always use model X for step 0) or dynamic policy
(the model signals "use a cheaper model for this subtask" via a tool call
that records a flag, which the router reads on the next step). Dynamic policy
requires a tool that writes session-level routing hints and a router that reads
them. Both are implementable; static is simpler.

---

### T3-3 · Anthropic / OpenAI LLM Providers

**Effort:** 3–5 days each

#### Start condition
- You have read `packages/llm/llm-deepseek/src/index.ts` and `adapter.ts` fully.

Register via `ctx.llm.registerAdapter`. Must support streaming, tool use,
vision, and the same abort-signal contract as the DeepSeek adapter. Credentials
through `ctx.credentials`.

`llm-deepseek` config for reference: `maxTokens` (default 256000, a cap not a
target) and `reasoningEffort` (`'off' | 'low' | 'high' | 'max'`).

#### Done when
- [ ] Streaming, tool use, and vision all work end to end.
- [ ] Token accounting is attributed correctly in session telemetry.

#### Stop checkpoint
Commit: `feat(llm): T3-3 add <provider> adapter`

---

## What a real IDE additionally requires

Everything above is agent capability. Verified state of IDE surfaces in the web
UI (`apps/web` + `packages/client/*`):

| Surface | State |
|---|---|
| Code editor (editable buffer) | **Absent.** No Monaco/CodeMirror dependency anywhere. Only 3 editable inputs exist in the whole client: chat composer, feedback box, question composer |
| File tree / project explorer | **Absent.** `WorkspaceBrowser` is the *session* list; `DirectoryBrowser` is a folder chooser. Clicking a file path shells out to the OS default app |
| Tabbed file buffers | **Absent.** The only tablist is conversation views (`chat`, `trajectory`) |
| Interactive terminal pane | **Absent.** `TerminalBlock` is read-only; the client has **no write channel to a PTY** (zero `stdin`/`ptyWrite` hits) |
| Git UI | **Absent.** No git package exists at all; git happens only via `tool-bash` |
| Project search/replace UI | **Absent.** Sidebar search is session search; `SearchBlock` renders tool results |
| Debugger / DAP | **Absent.** LSP exists (model-facing, no UI); DAP does not |
| IDE layout | **Absent.** `AppFrame` is a 3-column chat grid with no bottom panel region |

All code components in `ui-primitives` (`CodeBlock`, `DiffBlock`, `ReadBlock`,
`SearchBlock`, `TerminalBlock`, `WebBlock`, `HtmlPreviewBlock`,
`AppPreviewBlock`) are display-only.

**Two honest strategies:**

- **A — Attach to VS Code (T2-1).** Inherit every surface above from a mature
  IDE. Weeks of work. **Recommended.**
- **B — Build IDE surfaces in the web app.** Editor pane, file tree, tabs,
  a client→PTY write channel plus terminal emulator, git UI, search panel,
  DAP, and an `AppFrame` layout change. This is larger than the entire rest of
  this roadmap combined and is a product pivot, not a feature.

Pick A unless you have a specific reason the agent must live in a browser.

---

## Per-feature checklist

- [ ] Cordis plugin: `export const name`, `export const inject`, `export function apply(ctx)`
- [ ] Tool: `defineTool()` from `@deepseek-ai/dsh-tools`
- [ ] Prompt text: `ctx.systemPrompt.section({name, order, text})` wrapped in `ctx.effect(...)`
- [ ] Per-session data: `context.agent.session.header.cwd` (callback is sync)
- [ ] Secrets: `!!js process.env.X`, never `${X}`, never a literal in YAML
- [ ] New card type: interface + union member in `packages/core/tools/src/presentation.ts`, primitive mirroring `AppPreviewBlock`, wired into `ToolRow.tsx`
- [ ] New package: host/client project reference (mandatory) + `tsconfig.base.json` wildcards if a new group
- [ ] Bundle mount: a row in `packages/bundle/<b>/cordis.patch.yml` requires the package in `packages/bundle/<b>/package.json` `dependencies`
- [ ] Preset mount: a row in `apps/cli/config/agent-presets/<p>/agent.cordis.yml` requires the package in `apps/cli/package.json` `dependencies` (a green typecheck does not prove this)
- [ ] README with `## Model Experience` (three ordered H4s) + `## Known Limitations and Deferred Work`
- [ ] `pnpm run doc-sync` (regenerates catalogs; fails loud on uncovered `ctx.<key>`)
- [ ] `pnpm run constraints && npm run typecheck && npm run lint && npm run test`
- [ ] Max 140 chars/line (Lefthook)
- [ ] Update this roadmap: mark complete, record the real package path

---

*Verified against source 2026-08-18 · Owner: lkelly@corvusconstruction.com*
