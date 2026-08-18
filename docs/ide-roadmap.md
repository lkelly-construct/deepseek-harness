# IDE Feature Roadmap — Claude Code Parity

Authoritative implementation plan for extending DSH into a fully-featured
IDE-class agent harness. Each feature is a self-contained specification with a
clear start condition, acceptance gate, and stop checkpoint before the next
phase begins.

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

## Baseline — Already Shipped (no work needed)

| Capability | Package |
|---|---|
| File read / write / edit | `packages/fs/tool-fs` |
| Glob + ripgrep search | `packages/fs/tool-fs-search` |
| Bash execution | `packages/shell/tool-bash` |
| PowerShell execution (Windows) | `packages/shell/tool-pwsh` |
| Persistent PTY terminals | `packages/terminal/tool-terminal` |
| Web search + fetch | `packages/web/tool-web` |
| MCP client (stdio + HTTP/SSE) | `packages/mcp/mcp-client` |
| Subagents (spawn / fork / ACP / SDK) | `packages/subagent` |
| Todo / task list | `packages/todo/tool-todo` |
| Plan mode | `packages/plan/plan-mode` |
| Claude Code-compatible hooks | `packages/hooks/hooks-claude-code` |
| Context compaction | `packages/compaction` |
| Session persistence (JSONL + SQLite) | `packages/session` |
| Skills system | `packages/skill` |
| Workflow orchestration | `packages/workflow` |
| Background jobs | `packages/jobs/tool-jobs` |
| TypeScript code runtime | `packages/code-runtime` |
| E2B cloud sandbox | `packages/e2b` |
| Static HTML preview card | `packages/client/ui-primitives` |
| Live app preview card | `packages/examples/tool-app-preview` |
| LSP integration | `packages/lsp` |

---

## Tier 1 — Needs

### T1-1 · Wire `render_app_url` into the Standard Preset

**Effort:** 30 minutes

#### Start condition
- `packages/examples/tool-app-preview` builds cleanly (`pnpm run build`).
- You have confirmed the `render_app_url` tool is NOT listed in
  `apps/cli/config/agent-presets/standard/agent.cordis.yml`.

#### Steps

1. Open `apps/cli/config/agent-presets/standard/agent.cordis.yml`. After the
   last shell tool entry (`tool-bash` or `tool-pwsh`), add:

   ```yaml
   - id: tool-app-preview
     name: '@deepseek-ai/dsh-tool-app-preview'
   ```

2. Repeat in `apps/cli/config/agent-presets/code/agent.cordis.yml`.

3. Do **not** add it to `minimal/agent.cordis.yml` — that preset is
   intentionally stripped down.

#### Done when
- [ ] `render_app_url` appears in the tool list when a `standard` session
      starts (check the system prompt or tool registry log).
- [ ] Agent can start a Vite dev server via bash and call `render_app_url`
      with `http://localhost:<port>`; the chat UI renders the iframe card.
- [ ] No regressions in the `code` and `minimal` presets.

#### Stop checkpoint
Commit: `feat(preset): mount render_app_url in standard and code presets`
Do not start T1-2 until this commit is on master and the manual smoke test
above passes.

---

### T1-2 · Supabase MCP Preset

**Effort:** 1 hour (config only — zero new code)

#### Start condition
- T1-1 stop checkpoint is committed.
- You have a Supabase account and a personal access token from
  `https://supabase.com/dashboard/account/tokens`.

#### Steps

1. Create `apps/cli/config/agent-presets/supabase/agent.cordis.yml`:

   ```yaml
   # Supabase agent preset — standard tools + Supabase MCP
   # Requires: SUPABASE_ACCESS_TOKEN environment variable

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
         - '--access-token'
         - '${SUPABASE_ACCESS_TOKEN}'
       failOnStartupError: false
       reconnect:
         enabled: true
         initialDelayMs: 1000
         maxDelayMs: 30000
         maxAttempts: 5
   ```

2. Create `apps/cli/config/agent-presets/supabase/README.md`:

   ```markdown
   # Supabase preset

   Mounts the standard tool set plus the Supabase MCP server.

   ## Setup

   Export your Supabase personal access token before starting DSH:

   ```
   export SUPABASE_ACCESS_TOKEN=sbp_...
   dsh --preset supabase
   ```

   Tools appear as `mcp__supabase__<tool_name>` (e.g. `mcp__supabase__list_tables`).
   ```

#### Done when
- [ ] `SUPABASE_ACCESS_TOKEN=<token> dsh --preset supabase` starts without
      error.
- [ ] Agent can call `mcp__supabase__list_tables` and return results.
- [ ] Missing token logs a warning rather than crashing (covered by
      `failOnStartupError: false`).

#### Stop checkpoint
Commit: `feat(preset): add supabase MCP preset`
Do not start T1-3 until this commit is on master and you have verified
`mcp__supabase__list_tables` returns real data from your project.

---

### T1-3 · Windows PowerShell Shell Parity

**Effort:** 1–2 days

#### Start condition
- T1-2 stop checkpoint is committed.
- You are running DSH on Windows and can reproduce the bash-ism failures.

#### Steps

**Step 1 — Audit agent instructions for bash idioms**

Read every file under `packages/context/agent-instructions/src/`. Find every
hardcoded `bash -c`, `&&`, shell path like `/usr/bin/`, or Unix-only syntax
in prompt strings. Replace with platform branches:

```ts
const shell = process.platform === 'win32'
  ? 'powershell -Command'
  : 'bash -c'
```

**Step 2 — Ripgrep binary resolution**

Open `packages/fs/tool-fs-search/src/grep.ts`. Confirm the ripgrep binary
resolver checks `rg.exe` on `process.platform === 'win32'`. If it uses a
hardcoded `rg`, add:

```ts
const RG_BINARY = process.platform === 'win32' ? 'rg.exe' : 'rg'
```

**Step 3 — Sandbox degradation warning**

Open `packages/sandbox/sandbox-local/src/index.ts`. When
`process.platform === 'win32'` and the policy is non-trivial, add:

```ts
ctx.logger.warn(
  'sandbox-local: kernel confinement (Landlock/macOS sandbox) is not '
  + 'available on Windows; running unconfined'
)
```

**Step 4 — Integration test**

Add a test in `packages/shell/tool-pwsh/src/` that:
- Runs `Write-Output hello` and asserts stdout is `hello\n`.
- Runs a command that exceeds 120 s and asserts timeout fires.
- Runs a command that exits non-zero and asserts exit code propagates.

#### Done when
- [ ] Running DSH on Windows with the `standard` preset: `tool-pwsh` is
      selected, the agent generates PowerShell commands (not bash), and
      `tool-fs-search` grep works.
- [ ] The sandbox degradation warning appears in the log on Windows.
- [ ] The PowerShell integration tests pass: `pnpm test --filter tool-pwsh`.

#### Stop checkpoint
Commit: `fix(shell): Windows PowerShell parity — bash-isms, rg.exe, sandbox warning`
Do not start T1-4 until all three done criteria are green on a Windows machine.

---

### T1-4 · Cross-Session Persistent Memory

**Effort:** 2–3 days

#### Start condition
- T1-3 stop checkpoint is committed.
- You understand the `agentInstructions` service seam in
  `packages/context/agent-instructions/src/`.

#### Steps

**Step 1 — Create the package scaffold**

```
packages/memory/memory-local/
  package.json
  src/
    index.ts
    store.ts
    tool-save.ts
    tool-forget.ts
```

`package.json` follows the pattern of any tool package
(`packages/todo/tool-todo/package.json` is the closest analogue).

**Step 2 — Store (`store.ts`)**

Memory files live at `~/.dsh/memory/<projectHash>/<slug>.md`.
`projectHash` is `sha256(workspacePath).slice(0, 16)` (hex).

```ts
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { join, homedir } from 'node:path'

export function memoryDir(workspaceRoot: string): string {
  const hash = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16)
  return join(homedir(), '.dsh', 'memory', hash)
}

export async function readAllMemories(workspaceRoot: string): Promise<string[]> {
  const dir = memoryDir(workspaceRoot)
  try {
    const files = await readdir(dir)
    return Promise.all(
      files.filter(f => f.endsWith('.md')).map(f => readFile(join(dir, f), 'utf8'))
    )
  } catch {
    return []
  }
}

export async function writeMemory(
  workspaceRoot: string, slug: string, type: string, content: string
): Promise<void> {
  const dir = memoryDir(workspaceRoot)
  await mkdir(dir, { recursive: true })
  const body = `---\nname: ${slug}\ntype: ${type}\ncreated: ${new Date().toISOString()}\n---\n\n${content}\n`
  await writeFile(join(dir, `${slug}.md`), body, 'utf8')
}

export async function deleteMemory(workspaceRoot: string, slug: string): Promise<boolean> {
  try {
    await unlink(join(memoryDir(workspaceRoot), `${slug}.md`))
    return true
  } catch {
    return false
  }
}
```

**Step 3 — Tools (`tool-save.ts`, `tool-forget.ts`)**

```ts
// tool-save.ts
export function registerSaveMemoryTool(ctx: Context, workspaceRoot: string): void {
  ctx.tools.register(defineTool({
    name: 'save_memory',
    description:
      'Persist a named fact to cross-session memory. '
      + 'Use type="project" for project facts, "user" for user preferences, '
      + '"feedback" for corrections, "reference" for external resource pointers.',
    parameters: {
      slug:    { type: 'string', required: true,  description: 'kebab-case id, e.g. "supabase-project-ref"' },
      type:    { type: 'string', required: true,  description: '"user" | "project" | "feedback" | "reference"' },
      content: { type: 'string', required: true,  description: 'Markdown body of the memory' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute: async (args) => {
      await writeMemory(workspaceRoot, args.slug, args.type, args.content)
      return `Memory "${args.slug}" saved.`
    },
  }))
}
```

```ts
// tool-forget.ts
export function registerForgetMemoryTool(ctx: Context, workspaceRoot: string): void {
  ctx.tools.register(defineTool({
    name: 'forget_memory',
    description: 'Delete a named memory by its slug.',
    parameters: {
      slug: { type: 'string', required: true, description: 'Slug of the memory to delete' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute: async (args) => {
      const deleted = await deleteMemory(workspaceRoot, args.slug)
      return deleted ? `Memory "${args.slug}" deleted.` : `Memory "${args.slug}" not found.`
    },
  }))
}
```

**Step 4 — Plugin entry (`index.ts`)**

```ts
export const name = 'memory-local'
export const inject = ['tools', 'agentInstructions']

export async function apply(ctx: Context): Promise<void> {
  const workspaceRoot = ctx.workspace?.root ?? process.cwd()
  const memories = await readAllMemories(workspaceRoot)
  if (memories.length > 0) {
    ctx.agentInstructions.register({
      id: 'memory-local',
      priority: 10,
      text: `## Persistent memory\n\n${memories.join('\n\n---\n\n')}`,
    })
  }
  registerSaveMemoryTool(ctx, workspaceRoot)
  registerForgetMemoryTool(ctx, workspaceRoot)
}
```

**Step 5 — Mount in standard preset**

Add to `apps/cli/config/agent-presets/standard/agent.cordis.yml`:
```yaml
- id: memory-local
  name: '@deepseek-ai/dsh-memory-local'
```

#### Done when
- [ ] After calling `save_memory {slug: "test-fact", type: "project", content: "hello"}`
      in session A, the string `test-fact` appears in the agent's context
      in a fresh session B (same workspace, verify via system prompt log).
- [ ] `forget_memory {slug: "test-fact"}` removes it; session C no longer
      sees it.
- [ ] Memory files are human-readable markdown at `~/.dsh/memory/<hash>/`.
- [ ] Starting DSH in a different directory (different workspace root) does
      NOT see the first workspace's memories.

#### Stop checkpoint
Commit: `feat(memory): add memory-local plugin with save_memory and forget_memory tools`
Do not start T1-5 until all four done criteria are verified manually.

---

### T1-5 · Chat Session Deletion UI

**Effort:** 1 day

#### Start condition
- T1-4 stop checkpoint is committed.
- You are familiar with the session persistence API in
  `packages/session/session-persistence/src/`.

#### Steps

**Step 1 — Backend: add `deleteSession` to the abstract interface**

In `packages/session/session-persistence/src/index.ts`, add:

```ts
abstract deleteSession(id: SessionId): Promise<void>
```

**Step 2 — JSONL implementation**

In `packages/session/session-persistence-jsonl/src/index.ts`:

```ts
async deleteSession(id: SessionId): Promise<void> {
  const path = this.sessionFilePath(id)
  await unlink(path).catch(() => {})
}
```

**Step 3 — SQLite implementation**

In `packages/session/session-persistence-sqlite/src/index.ts`:

```ts
async deleteSession(id: SessionId): Promise<void> {
  this.db.prepare('DELETE FROM events WHERE session_id = ?').run(id)
  this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}
```

Guard: before deleting, check if `id` equals the current active session ID
and throw `new Error('Cannot delete the active session')` if so.

**Step 4 — REST endpoint**

In `packages/api/gateway/src/`, add:

```
DELETE /sessions/:id
```

The handler calls `ctx.sessionPersistence.deleteSession(id)` and returns
`204 No Content` on success, `409 Conflict` if the session is active, and
`404 Not Found` if the session does not exist.

**Step 5 — Frontend: delete button in the session sidebar**

Locate the session list component under `packages/client/`. Add:

- A trash icon button per session row, visible on hover.
- Aria label: `"Delete session"`.
- On click: show a confirmation dialog — "Delete this session? This cannot
  be undone." — before calling `DELETE /sessions/:id`.
- On confirm: optimistically remove the row from the local list; show a
  toast on error.

#### Done when
- [ ] Hovering a session row in the sidebar reveals a trash button.
- [ ] Confirming deletion removes the session from the list.
- [ ] The JSONL file is gone from `~/.dsh/sessions/` after deletion.
- [ ] Attempting to delete the currently active session shows a toast error
      and does nothing.
- [ ] Deleted sessions do not appear in session search results.

#### Stop checkpoint
Commit: `feat(session): add delete session API and sidebar UI`
All Tier 1 features are now complete. Run the full test suite
(`pnpm test`) and fix any regressions before starting Tier 2.

---

## Tier 2 — Wants

### T2-1 · VS Code Extension

**Effort:** 5–10 days

#### Start condition
- All Tier 1 stop checkpoints are committed and green.
- You have reviewed `packages/sdk/client/src/` and understand the JSON-RPC
  session protocol the extension will use.
- Node.js and the VS Code Extension API are familiar territory.

#### Steps

**Step 1 — Scaffold the extension package**

Create `apps/vscode/` with:

```
apps/vscode/
  package.json          # VS Code extension manifest (engines.vscode >= 1.90)
  tsconfig.json
  src/
    extension.ts        # activate() / deactivate()
    DshSession.ts       # wraps packages/sdk/client session lifecycle
    sidebar/
      ChatPanel.ts      # WebviewPanel — mounts the web UI via local HTTP
      SessionPanel.ts   # TreeDataProvider — session list in the sidebar
    commands/
      newSession.ts     # "DSH: New Session" command
      openInDsh.ts      # right-click context menu → "Open in DSH"
    fileDiff.ts         # intercepts edit tool results → VS Code diff editor
```

**Step 2 — Session connection via SDK**

`DshSession.ts` spawns `dsh --sdk-mode` (uses `packages/sdk/server`) as a
child process and connects using the TypeScript client from
`packages/sdk/client`. One `DshSession` per VS Code chat pane.

**Step 3 — Chat UI via WebviewPanel**

`ChatPanel.ts` starts a local HTTP server on a free port, serves the
existing web UI assets from `packages/client/`, and loads that URL in a
`vscode.WebviewPanel`. No separate UI needs to be built.

**Step 4 — File diff integration**

When the DSH session calls the `edit` tool, the SDK event fires in
`fileDiff.ts`. Instead of applying the diff silently, open it in VS Code's
native diff editor (`vscode.commands.executeCommand('vscode.diff', ...)`)
so the user can review before accepting.

**Step 5 — File path links**

Wire the `onOpenFile` callback (already in `ToolRow.tsx`) to send a
message from the webview to the extension host, which calls
`vscode.workspace.openTextDocument` + `showTextDocument` at the correct
line.

#### Done when
- [ ] "DSH: New Session" opens a sidebar chat pane and the agent responds.
- [ ] Agent can call `read`, `write`, and `edit` on files in the open
      workspace.
- [ ] File paths rendered in tool rows are clickable and jump the VS Code
      editor cursor to the correct line.
- [ ] Agent-proposed edits open in the VS Code diff editor before applying.
- [ ] The extension activates without error on a fresh VS Code install
      (no global npm installs required beyond the extension itself).

#### Stop checkpoint
Commit: `feat(vscode): initial VS Code extension — chat panel, file diffs, path links`
Publish to the VS Code marketplace (or a private VSIX) and have a second
person install and test it before starting T2-2.

---

### T2-2 · True Cron Scheduling

**Effort:** 3–5 days

#### Start condition
- T2-1 stop checkpoint is committed (or T2-1 is intentionally deferred and
  T1-5 is the last green checkpoint).
- You have read `packages/schedule/` and understand how session-local
  reminders work.

#### Steps

**Step 1 — Create `packages/schedule/schedule-cron/`**

Follow the package scaffold pattern from `packages/todo/tool-todo`.

**Step 2 — Data model and persistence (`store.ts`)**

Persist to `~/.dsh/cron.json`:

```ts
interface CronEntry {
  id: string           // nanoid
  expression: string   // 5-field cron, e.g. "0 2 * * *"
  prompt: string       // initial user turn for the spawned session
  presetId: string     // agent preset id
  workspaceRoot: string
  enabled: boolean
  lastFiredAt?: string // ISO 8601
  nextFireAt: string   // ISO 8601, recomputed after each fire
}
```

Use the `cron-parser` npm package (add as a dependency) to compute
`nextFireAt` from `expression`.

**Step 3 — Scheduler loop**

The plugin starts a `setInterval` that fires every 30 seconds and checks
whether any enabled entry has `nextFireAt <= Date.now()`. On match:

1. Call `ctx.subagent.spawn({ preset: entry.presetId, initialTurn: entry.prompt })`.
2. Update `lastFiredAt` and recompute `nextFireAt`.
3. Write the updated entry back to `cron.json`.

**Step 4 — Model-facing tools**

Register four tools from the plugin entry: `cron_create`, `cron_list`,
`cron_delete`, `cron_toggle`. See T2-2 parameter shapes in the original
specification below (kept for reference).

**Step 5 — Boot integration**

Import and start `CronScheduler` in `packages/boot/app-boot/src/index.ts`.
Stop the scheduler on context disposal.

#### Done when
- [ ] `cron_create {expression: "*/2 * * * *", prompt: "say hello", presetId: "standard"}`
      fires a new session approximately every 2 minutes.
- [ ] `cron_list` returns the entry with a valid `nextFireAt`.
- [ ] Stopping and restarting DSH preserves the cron entry.
- [ ] `cron_toggle` pauses and resumes firing.
- [ ] A spawned session appears in the session list with a `[cron]` tag.

#### Stop checkpoint
Commit: `feat(schedule): add schedule-cron package with cron_create/list/delete/toggle tools`
Run a 10-minute soak test with a `*/1 * * * *` entry before starting T2-3.

---

### T2-3 · Artifact Publishing

**Effort:** 2–3 days

#### Start condition
- T2-2 stop checkpoint is committed (or T2-2 deferred and T2-1 is green).
- You have an S3-compatible bucket (AWS S3, Cloudflare R2, or MinIO)
  and credentials.

#### Steps

**Step 1 — Create `packages/artifact/artifact-s3/`**

**Step 2 — Upload logic (`upload.ts`)**

Use `@aws-sdk/client-s3` (already a common dep in Node.js stacks). Config
comes from DSH settings: `artifact.s3.bucket`, `artifact.s3.region`,
`artifact.s3.prefix`, `artifact.s3.publicUrlBase`.

```ts
async function uploadHtml(
  key: string, html: string, ttlDays: number
): Promise<string> {
  await s3.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: `${config.prefix}/${key}`,
    Body: html,
    ContentType: 'text/html; charset=utf-8',
    ...(ttlDays > 0 ? { Expires: new Date(Date.now() + ttlDays * 86400_000) } : {}),
  }))
  return `${config.publicUrlBase}/${config.prefix}/${key}`
}
```

**Step 3 — `publish_artifact` tool**

Parameters: `mode` (`"html"`), `content` (raw HTML), `title`, `ttlDays`.
Returns an `artifact` card:

```ts
return {
  card: 'artifact',
  title: args.title,
  publicUrl,
  ...(args.ttlDays > 0 ? { expiresAt: new Date(Date.now() + args.ttlDays * 86400_000).toISOString() } : {}),
}
```

**Step 4 — Add `ArtifactResultView` to presentation types**

In `packages/core/tools/src/presentation.ts`:

```ts
export interface ArtifactResultView {
  card: 'artifact'
  title?: string
  publicUrl: string
  expiresAt?: string
}
```

Add to the `ToolResultView` union.

**Step 5 — `ArtifactBlock` UI primitive**

Create `packages/client/ui-primitives/src/ArtifactBlock.tsx` mirroring
`AppPreviewBlock`. Render a link card: title, public URL (clickable),
copy button, optional expiry badge. Wire it into `ToolRow.tsx`.

#### Done when
- [ ] Agent calls `publish_artifact {mode: "html", content: "<h1>hi</h1>", title: "test"}`
      and the chat renders an artifact card.
- [ ] The URL in the card is publicly reachable in a browser without
      authentication.
- [ ] `ttlDays: 3` causes the S3 object to expire in 3 days (verify via
      the AWS console or `aws s3api head-object`).
- [ ] The artifact card survives session replay (URL stored in
      `presentationMeta`).

#### Stop checkpoint
Commit: `feat(artifact): add artifact-s3 package and ArtifactBlock UI card`

---

### T2-4 · Jupyter Notebook Editing

**Effort:** 2 days (skip if no data science workflow)

#### Start condition
- T2-3 stop checkpoint is committed (or T2-3 deferred).
- Python and Jupyter are installed in the target environment.

#### Steps

**Step 1 — Create `packages/fs/tool-notebook/`**

**Step 2 — Notebook I/O (`notebook.ts`)**

`.ipynb` files are JSON. Read, edit, and write via `fs.readFile` /
`JSON.parse` / `JSON.stringify`. No external library needed.

```ts
interface NotebookCell { cell_type: 'code' | 'markdown'; source: string[] }
interface Notebook { cells: NotebookCell[] }
```

**Step 3 — `notebook_edit` tool**

Commands: `read` (returns cells as numbered list), `insert` (adds a cell
at `cellIndex`), `replace` (replaces source at `cellIndex`), `delete`
(removes cell at `cellIndex`).

**Step 4 — `run` command (optional)**

If `ctx.shell` is available, execute the cell via:
```
jupyter nbconvert --to notebook --execute --inplace <path>
```

#### Done when
- [ ] `notebook_edit {path: "...", command: "read"}` returns the cell list.
- [ ] `insert` + `replace` + `delete` round-trip correctly on a real
      `.ipynb` file.
- [ ] `run` executes the notebook and outputs appear in the result.

#### Stop checkpoint
Commit: `feat(fs): add tool-notebook with notebook_edit tool`

---

## Tier 3 — Stretch

### T3-1 · Browser Automation via Playwright MCP

**Effort:** 1 hour (config only — no code)

#### Start condition
- All Tier 1 features are complete.

#### Steps

1. Create `apps/cli/config/agent-presets/browser/agent.cordis.yml`:

   ```yaml
   # Browser automation preset — standard tools + Playwright MCP
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
- [ ] Agent in the `browser` preset can call `mcp__playwright__navigate`
      and return page content.
- [ ] Agent can take a screenshot and the result appears in the chat.

#### Stop checkpoint
Commit: `feat(preset): add browser automation preset with Playwright MCP`

---

### T3-2 · Multi-Model Router

**Effort:** 4–5 days

#### Start condition
- T3-1 is committed.
- You understand the `ctx.llm` middleware seam in `packages/llm/llm/src/`.

#### Steps

**Step 1 — Create `packages/llm/llm-router/`**

**Step 2 — Rule matching (`rules.ts`)**

A rule matches on: `toolName` (regex), `messageTokenCount` (threshold),
`goalType` (string), or `default`. First matching rule wins.

**Step 3 — Middleware plugin (`index.ts`)**

```ts
ctx.llm.middleware(async (request, next) => {
  const rule = resolveRule(config.rules, request)
  return next({ ...request, model: rule.model })
})
```

**Step 4 — Status bar indicator**

Expose the active model via a settings value the UI status bar can read.

#### Done when
- [ ] With two rules (analysis → `deepseek-reasoner`, default →
      `deepseek-chat`), session logs show the correct model per turn.
- [ ] The active model is visible in the UI status bar.
- [ ] Token costs are attributed per-model in session telemetry.

#### Stop checkpoint
Commit: `feat(llm): add llm-router middleware package`

---

### T3-3 · Anthropic / OpenAI LLM Provider

**Effort:** 3–5 days each

#### Start condition
- T3-2 stop checkpoint is committed.
- You have read `packages/llm/llm-deepseek/src/index.ts` completely —
  this is the template to replicate.

#### Steps

**Anthropic (`packages/llm/llm-anthropic/`)**

Implement the `LlmProvider` seam against `api.anthropic.com/v1/messages`
using `@anthropic-ai/sdk`. Must support: streaming, tool use, vision,
system prompts, and the same abort-signal contract as `llm-deepseek`.

Credentials: `ANTHROPIC_API_KEY` via `ctx.credentials`.

**OpenAI (`packages/llm/llm-openai/`)**

Same pattern against `api.openai.com/v1/chat/completions`. Also works for
any OpenAI-schema provider (Groq, OpenRouter direct, etc.) via a
configurable `baseUrl`.

#### Done when
- [ ] `llm-anthropic` in a preset sends a message and streams the response.
- [ ] Tool use works end-to-end (agent calls a tool, result returns).
- [ ] `llm-router` (T3-2) can route between `llm-deepseek` and
      `llm-anthropic` in the same session.

#### Stop checkpoint
Commit: `feat(llm): add llm-anthropic and llm-openai provider packages`

---

## Implementation Order Summary

```
Immediate (config, no code needed)
  T1-1  render_app_url in standard preset          30 min
  T1-2  Supabase MCP preset                         1 hr
  ── STOP: smoke test both before continuing ──

Week 1
  T1-3  Windows PowerShell parity                   2 days
  T1-4  Cross-session persistent memory             3 days
  ── STOP: run pnpm test, fix regressions ──

Week 2
  T1-5  Chat session deletion UI                    1 day
  ── STOP: full Tier 1 complete; run pnpm test ──

Week 3–4
  T2-1  VS Code extension                           5–10 days
  ── STOP: second person installs and tests VSIX ──

Week 5
  T2-2  True cron scheduling                        3–5 days
  T2-3  Artifact publishing                         2–3 days
  T2-4  Jupyter notebook editing                    2 days
  ── STOP: run pnpm test; soak test cron for 10 min ──

Week 6+
  T3-1  Playwright MCP (config only)                1 hr
  T3-2  Multi-model router                          4–5 days
  T3-3  Anthropic / OpenAI LLM providers            3–5 days each
```

---

## Adding any new tool — checklist

Use this for every feature above:

- [ ] New Cordis plugin: `export const name`, `export const inject`, `export function apply(ctx)`
- [ ] New tool: use `defineTool()` from `@deepseek-ai/dsh-tools`
- [ ] New card type: add interface to `packages/core/tools/src/presentation.ts` + union member
- [ ] New UI primitive: mirror `AppPreviewBlock` structure; wire into `ToolRow.tsx` card chain
- [ ] Add plugin row to relevant presets in `apps/cli/config/agent-presets/`
- [ ] Add package to the monorepo workspaces field in root `package.json`
- [ ] Max 140 chars/line (Lefthook lint gate)
- [ ] `pnpm test` green before committing
- [ ] Update this roadmap: mark feature complete, note package path

---

*Last updated: 2026-08-18 · Owner: lkelly@corvusconstruction.com*
