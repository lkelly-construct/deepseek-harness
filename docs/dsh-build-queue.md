# DSH Build Queue — Execute Literally

A fixed queue of tasks drawn from `docs/ide-roadmap.md`. That roadmap is the
specification of record; this file orders the work and adds execution
discipline.

> **Verified 2026-08-18.** An earlier revision of both documents contained
> fabricated APIs and invalid commands. All commands below are real. If any
> instruction does not match what you find in source, **source wins** — stop and
> report the mismatch rather than working around it.

## Rules

1. Work items in order. Do not start item N+1 until item N's stop checkpoint is
   complete and approved.
2. At each stop checkpoint: run the listed commands, report the output verbatim,
   and **wait for explicit approval** before committing or continuing.
3. If a step is ambiguous, or a file/API/path does not exist as described, STOP
   and report it. Do not guess, do not invent an equivalent, do not work around
   it. A wrong guess here costs more than a question.
4. Before writing code against any service (`ctx.<something>`), open the file
   that defines it and confirm the method name and signature. Do not trust an
   API name from memory or from a doc without checking source.
5. Commit messages reference the roadmap item id (e.g. `T1-1`).
6. Touch only the files an item's steps name explicitly.
7. Read these before starting item 1:
   - `docs/ide-roadmap.md` — the whole "Repo conventions you must know first"
     section, then the sections for the items below.
   - `docs/cookbook/adding-a-package.md` — required for items 4, 6, 7.

## Commands that are real

```bash
npm run typecheck      # builds host libs then tsc -b tsconfig.client.json
npm run lint
npm run test
npm run build
pnpm run constraints
pnpm run doc-sync
```

`pnpm --filter <pkg> build` does **not** work — packages under `packages/`
have no `scripts` block. Never use it.

---

## Queue

### Item 1 — T1-1: Mount `render_app_url` in the standard and code presets

Spec: `docs/ide-roadmap.md` § T1-1.

Stop checkpoint:
```bash
git diff apps/cli/config/agent-presets/standard/agent.cordis.yml apps/cli/config/agent-presets/code/agent.cordis.yml
npm run typecheck
```

---

### Item 2 — T1-2: Supabase MCP preset

Spec: `docs/ide-roadmap.md` § T1-2.

**Critical:** there is no `${VAR}` interpolation in preset YAML. Use
`!!js process.env.SUPABASE_ACCESS_TOKEN`. Before writing the file, read
`packages/mcp/mcp-client/README.md` and confirm the `!!js` env pattern, and read
the `Config` schema in `packages/mcp/mcp-client/src/index.ts` to confirm every
field name you use exists.

Stop checkpoint:
```bash
cat apps/cli/config/agent-presets/supabase/agent.cordis.yml
ls apps/cli/config/agent-presets/supabase/
```
Also state in your report: how a user selects this preset. (There is no
`--preset` CLI flag — confirm the real mechanism from the roadmap and from
`packages/preset/agent-presets/src/`.)

---

### Item 3 — T3-1: Playwright MCP preset

Spec: `docs/ide-roadmap.md` § T3-1. No token, so no `!!js` needed.

Stop checkpoint:
```bash
cat apps/cli/config/agent-presets/browser/agent.cordis.yml
```

---

### Item 4 — T1-4: Cross-session persistent memory

Spec: `docs/ide-roadmap.md` § T1-4.

This is a **new package group** (`packages/memory/`), so it needs
`tsconfig.base.json` wildcard entries *and* a `tsconfig.host.json` project
reference. Neither is optional and neither is globbed.

Before writing any file, run these and report the output:
```bash
cat packages/preset/persona/src/index.ts
cat packages/preset/persona/package.json
cat packages/preset/persona/tsconfig.json
```
`persona` is the working reference for a plugin that contributes system-prompt
text. Copy its structure.

Then confirm three things in source and report what you found:
1. The exact `PromptSection` fields in `packages/core/system-prompt/src/index.ts`
   (the fields are `name` and `order` — **not** `id`/`priority`).
2. The exact payload shape of the `agent/created` event in
   `packages/core/agent/src/runtime-types.ts` before writing a listener for it.
3. Whether `ctx.storage` (`packages/storage/storage-json`) is a better fit than
   raw `node:fs` for the memory store. Report your recommendation; do not switch
   without approval.

Stop checkpoint:
```bash
pnpm install
pnpm run doc-sync
pnpm run constraints
npm run typecheck
npm run lint
npm run test
git status --short
```

---

### Item 5 — T1-5: True session deletion

Spec: `docs/ide-roadmap.md` § T1-5.

**Read the roadmap section fully before touching code.** Session *archive*
already ships end to end with an 11-file call chain, and the roadmap lists every
hop. Mirror it. The wire layer is **Typert RPC / dotted-method**, not REST —
there is no `DELETE /sessions/:id`.

Before writing any file, run these and report the output:
```bash
cat packages/session/session-persistence/src/index.ts
cat packages/host/apiproxy/src/api/workspace.ts
cat packages/host/apiproxy/src/api/workspace.schema.ts
```

Then report, before implementing:
- The exact list of abstract members on `SessionPersistence` and where a new
  `delete` belongs.
- Every implementor and test double that must be updated (an abstract member is
  a breaking change to all of them, including
  `packages/client/connection/src/client/fixture.ts`).
- The existing `archiveSession` chain, hop by hop, as you will mirror it.

Note the base class documents itself as **append-only**. State your reasoning for
why removing a whole log is consistent with that, in the JSDoc.

Stop checkpoint:
```bash
npm run typecheck
npm run lint
npm run test
git status --short
```

---

### Item 6 — T2-2: Autonomous scheduled sessions

Spec: `docs/ide-roadmap.md` § T2-2.

This is **not** a new package. `packages/schedule/schedule` already implements
durable recurring schedules; the gap is delivery mode. Do not create
`schedule-cron`.

`ctx.subagents` **cannot** start a root session (both start methods require
`parent: Agent`). The correct API is `ctx.agents.create(CreateAgentOptions)`
with `meta.agentPreset` and no `meta.parentSession`.

Before writing any file, run these and report the output:
```bash
cat packages/schedule/schedule/README.md
cat packages/schedule/schedule/src/index.ts
```
And report the create-then-first-turn reference implementation from
`packages/bundle/headless/src/index.ts` (around lines 111-125), including how it
obtains a `sessionId`.

Stop checkpoint:
```bash
npm run typecheck
npm run lint
npm run test
git status --short
```

---

### Item 7 — T2-4: Jupyter notebook editing

Spec: `docs/ide-roadmap.md` § T2-4. Existing group (`packages/fs/`), so only a
`tsconfig.host.json` project reference is needed — no `tsconfig.base.json` edit.

Stop checkpoint:
```bash
pnpm run constraints
npm run typecheck
npm run lint
npm run test
git status --short
```

---

## After Item 7

Stop. Report that the queue is complete and wait.

Do **not** start these — they are handled in a separate track because they
require design decisions rather than implementation:

- **T1-3** (Windows parity) — needs judgment about what actually breaks.
- **T2-1** (VS Code extension) — novel architecture; early decisions are costly
  to unwind.
- **T2-3** (Artifact publishing) — public URLs plus cloud credentials; needs a
  security review first.
- **T3-2** (Multi-model routing) — the obvious seam is already occupied by
  `installModelSelection` and `prepareCall` deep-freezes its config. This is an
  unsolved design problem, not a coding task.
- **T3-3** (New LLM providers) — correctness-critical streaming and tool-use
  parity.
