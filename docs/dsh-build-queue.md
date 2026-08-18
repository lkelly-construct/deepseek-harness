# DSH Build Queue — Execute Literally

You are working through a fixed queue of tasks from `docs/ide-roadmap.md`.
This file is your **only** source of instructions for these tasks — do not
invent scope, do not reorder tasks, do not skip a stop checkpoint.

## Rules

1. Work items in the order listed below. Do not start item N+1 until item N's
   **stop checkpoint** is complete.
2. At each stop checkpoint: run the commands listed, report the output, and
   wait for explicit approval before continuing to the next item.
3. If a step is ambiguous or a file/path mentioned doesn't exist as
   described, STOP and report the discrepancy. Do not guess or improvise a
   fix.
4. Every commit message must reference the roadmap item id (e.g. `T1-1`).
5. Do not touch any file outside what each item's steps name explicitly.
6. Read `docs/ide-roadmap.md` in full before starting item 1 — it has the
   complete specification (start condition, steps, done-when criteria) for
   every item below. This file only orders the queue and adds execution
   discipline; the roadmap is the spec of record.

---

## Queue

### Item 1 — T1-1: Wire `render_app_url` into the Standard Preset

Follow `docs/ide-roadmap.md` section **T1-1** exactly.

Stop checkpoint commands:
```
git diff apps/cli/config/agent-presets/standard/agent.cordis.yml apps/cli/config/agent-presets/code/agent.cordis.yml
```
Report the diff. Do not commit until told to proceed.

---

### Item 2 — T1-2: Supabase MCP Preset

Follow `docs/ide-roadmap.md` section **T1-2** exactly.

Stop checkpoint commands:
```
ls apps/cli/config/agent-presets/supabase/
cat apps/cli/config/agent-presets/supabase/agent.cordis.yml
```
Report the output. Do not commit until told to proceed.

---

### Item 3 — T3-1: Browser Automation via Playwright MCP

Follow `docs/ide-roadmap.md` section **T3-1** exactly.

Stop checkpoint commands:
```
cat apps/cli/config/agent-presets/browser/agent.cordis.yml
```
Report the output. Do not commit until told to proceed.

---

### Item 4 — T1-4: Cross-Session Persistent Memory

Follow `docs/ide-roadmap.md` section **T1-4** exactly. Use the code given in
that section verbatim as your starting point — do not redesign the store
format, the tool parameter shapes, or the hashing scheme.

Before writing any file, run this and report the output (confirms the
scaffold location is clear and the naming pattern to copy):
```
ls packages/todo/tool-todo/
cat packages/todo/tool-todo/package.json
```

Stop checkpoint commands:
```
pnpm --filter @deepseek-ai/dsh-memory-local build
git status --short packages/memory/
git diff apps/cli/config/agent-presets/standard/agent.cordis.yml
```
Report the output. Do not commit until told to proceed.

---

### Item 5 — T1-5: Chat Session Deletion UI

Follow `docs/ide-roadmap.md` section **T1-5** exactly.

Before writing any file, run this and report the output (confirms the
exact shape of the abstract interface you are extending):
```
cat packages/session/session-persistence/src/index.ts
```
If the file does not contain an abstract class/interface matching the
description in the roadmap, STOP and report the mismatch instead of
guessing where to add `deleteSession`.

Stop checkpoint commands:
```
pnpm --filter @deepseek-ai/dsh-session-persistence build
pnpm --filter @deepseek-ai/dsh-session-persistence-jsonl build
pnpm --filter @deepseek-ai/dsh-session-persistence-sqlite build
git status --short
```
Report the output. Do not commit until told to proceed.

---

### Item 6 — T2-2: True Cron Scheduling

Follow `docs/ide-roadmap.md` section **T2-2** exactly. Use the `CronEntry`
shape and tool parameter shapes given verbatim.

Before writing any file, run this and report the output (confirms whether
`cron-parser` needs adding as a new dependency):
```
cat package.json | grep -i cron
```

Stop checkpoint commands:
```
pnpm --filter @deepseek-ai/dsh-schedule-cron build
git status --short packages/schedule/
```
Report the output. Do not commit until told to proceed.

---

### Item 7 — T2-4: Jupyter Notebook Editing

Follow `docs/ide-roadmap.md` section **T2-4** exactly.

Stop checkpoint commands:
```
pnpm --filter @deepseek-ai/dsh-tool-notebook build
git status --short packages/fs/tool-notebook/
```
Report the output. Do not commit until told to proceed.

---

## After Item 7

Stop. Do not continue to any Tier 2 item not listed above (T2-1, T2-3) or
any Tier 3 item not listed above (T3-2, T3-3) — those are being handled in
a separate track. Report that the queue is complete and wait for further
instructions.
