# DSH Improvement Plan

Successor to `docs/ide-roadmap.md`, written after the 2026-08-19 audit of every
implemented tier. That audit found four shipped features that had never once
executed. This plan fixes the *reason* they shipped broken before adding
anything new.

> **Read this first if you are an agent working in this repo.** Phase 0 is not
> optional preamble. Every later phase depends on the gates it installs, because
> those gates are what make a later phase verifiable rather than hopeful.

---

## Part 1 — What actually went wrong, and what it implies

Four plugins (`memory-local`, `tool-artifact-publish`, `tool-notebook`,
`model-router`) were referenced by compositions but declared in no consumer
manifest. `healProfilesModuleFallback`
(`packages/boot/app-boot/src/profile.ts:223`) BFSes `dependencies` +
`peerDependencies` from `apps/cli/package.json`, symlinks what it reaches into
`$DSH_HOME/profiles/node_modules`, and at line 244 **skips** what it cannot
resolve rather than failing. So the plugin never mounted and nothing said so.

This was not a reasoning failure. It had exactly two mechanical causes:

**Cause A — the resolution gate has a blind spot.**
`scripts/verify-cordis-config.ts` *does* check that every composition row's
package is reachable from a consumer manifest (`validateAppResolution`, line
261). But its `shipped` set is built with a **non-recursive** glob:

```ts
const shipped = new Set(globSync('*.cordis.yml', { cwd: resolve(root, 'apps/cli/config') }))
```

That matches `apps/cli/config/*.cordis.yml` and therefore **excludes
`apps/cli/config/agent-presets/*/agent.cordis.yml`**. Preset rows are read
elsewhere in the same file (line 161, for plane separation) but are never
resolution-checked. Three of the four dead plugins were preset rows.

**Cause B — the gate was never run.**
`model-router` was a `packages/bundle/base/cordis.patch.yml` row, which *is* in
scope of the bundle loop at line 277. The gate would have caught it. It was not
run, because `pnpm run hygiene` was already red for unrelated reasons and had
stopped being a signal.

### What this implies about model capability

The instructive data point: **a frontier model introduced this exact bug in this
repo and did not notice.** Claude Opus 5 built `model-router`, wired the row,
confirmed typecheck and build were green, and shipped it dead. It was found only
by reading the loader's BFS implementation directly.

So the failure mode is not "the model wasn't smart enough to reason it out." It
is "the invariant was invisible, silent, and unenforced, and the artifact that
would have revealed it was not consulted." Under those conditions model strength
buys you very little — a stronger model fails slightly less often at a task that
should not depend on diligence at all.

The correct lever is therefore **mechanical enforcement, not model escalation.**
Once an invariant fails loud, a mid-tier model satisfies it reliably, because the
feedback loop closes without judgment. See Part 5 for where model strength does
genuinely matter.

---

## Part 2 — Phase 0: the guardrails (do this first, nothing else before it)

### T0-1 · Close the resolution-gate blind spot

**Why first:** this is the single change that makes the whole class of failure
impossible. Without it every later phase is unverifiable.

**Steps**

1. In `scripts/verify-cordis-config.ts` `validateAppResolution()`, replace the
   non-recursive `shipped` glob so preset compositions are included:

   ```ts
   const shipped = new Set([
     ...globSync('*.cordis.yml', { cwd: resolve(root, 'apps/cli/config') })
       .map(file => `apps/cli/config/${file}`),
     ...globSync('apps/cli/config/agent-presets/*/agent.cordis.yml', { cwd: root }),
   ])
   ```

   Preset rows resolve from `apps/cli/package.json` plus every bundle manifest —
   the same surface `appDependencies` already builds — so no second dependency
   set is needed.

2. Add a regression fixture: a preset row naming a package absent from
   `apps/cli/package.json` must produce a violation. Without this the glob can
   silently regress to non-recursive again.

**Done when**
- [ ] Reverting any one of the four dependency lines added in commit `242fc2e647` makes `pnpm run verify-cordis-config` fail and **name the offending row**.
- [ ] `pnpm run verify-cordis-config` passes on `main` unchanged.

---

### T0-2 · Make the loader fail loud on an unresolvable row

**Why:** T0-1 catches it at CI time. This catches it at runtime, including for
out-of-tree plugins and user `cordis.patch.yml` rows that no gate can see.

**Steps**

1. `packages/boot/app-boot/src/profile.ts:244` currently skips a
   declared-but-unresolvable dependency silently. Keep the skip (it is correct
   for non-plugin deps) but record the skipped names.
2. When the Loader later fails to resolve a row's `name`, include the recorded
   skip list in the error so the message states the actual cause — "declared in
   no consumer manifest reachable from `apps/cli/package.json`" — rather than a
   bare module-not-found.

**Done when**
- [ ] A composition row naming an undeclared workspace package produces a startup error naming the row `id`, the package, and the manifest that should declare it.
- [ ] A profile with only valid rows boots unchanged (regression).

---

### T0-3 · Restore the test suite

**Why:** currently 387 files / 4863 tests fail locally, so no tier has a working
test gate. Diagnosed, not yet fixed.

**Diagnosis so far:** `FiberState` resolves to `undefined` inside
`scripts/test-invariants.ts:95`. It is declared `export const enum FiberState`
(`vendor/cordis/src/fiber.ts:147`) — a TypeScript construct erased at runtime —
and `grep -c FiberState vendor/cordis/lib/index.js` returns `0`. Compounding it,
~360 untracked stale `.js`/`.d.ts` build artifacts sit inside `src/` directories
(gitignored by `.gitignore:42` `**/src/*.js`) where they can shadow `.ts`
sources under vitest's transpile-only resolution. This is **local pollution, not
a committed defect** — a fresh clone would not reproduce it.

**Steps**

1. Remove untracked build artifacts from `src/` trees only. Do **not** run a
   broad `git clean -xdf`: it would also delete `.env` files and local config.
   Scope it to `**/src/*.{js,d.ts,map}` that git does not track.
2. Re-run `npm run test`. Capture full output to a file — do not pipe through
   `tail`, which masks the exit code.
3. If failures persist, the `const enum` is the cause rather than the shadowing.
   Convert `FiberState` to a plain `enum` (or a `const` object plus a union
   type), which survives transpile-only builds. Note `vendor/` has a rescope
   guard (`pnpm run rescope-vendor:check`) — confirm the edit is permitted there
   before making it.

**Done when**
- [ ] `npm run test` exits 0 with a failure count of 0, verified from full captured output rather than a tail.
- [ ] The pass/fail total is recorded here as the baseline for future phases.

---

### T0-4 · Make the gates the definition of done

**Why:** Cause B was a process failure. `hygiene` was red, so it stopped being
consulted, so it stopped catching anything.

**Steps**

1. Get `pnpm run hygiene` fully green. As of commit `242fc2e647`: `constraints`,
   `verify-package-invariants`, and `verify-cordis-config` pass; `knip` still
   reports unused files and unlisted binaries. Fix or explicitly allowlist every
   remaining item — an allowlist entry with a reason is acceptable, a red gate is
   not.
2. Add `hygiene` to the **pre-push** hook alongside the existing `typecheck`. It
   is too slow for pre-commit; pre-push is the right boundary.
3. Record in `AGENTS.md` that a task is not complete until
   `typecheck && lint && test && hygiene` all pass. See T0-5.

**Done when**
- [ ] `pnpm run hygiene` exits 0.
- [ ] A push introducing an undeclared composition row is rejected by the hook.

---

### T0-5 · Write the invisible invariants down where an agent will read them

**Why:** `docs/cookbook/adding-a-package.md` documents the `package.json`
constraints in detail but **never states that a composition row requires a
consumer-manifest dependency.** An agent following the cookbook exactly still
ships a dead plugin.

**Steps**

1. Add a "Mounting a plugin" section to `docs/cookbook/adding-a-package.md`
   stating both planes and their manifests:
   - a row in `packages/bundle/<b>/cordis.patch.yml` requires the package in
     `packages/bundle/<b>/package.json` `dependencies`
   - a row in `apps/cli/config/agent-presets/<p>/agent.cordis.yml` requires it in
     `apps/cli/package.json` `dependencies`
   - `tsconfig.host.json` references are a **compile-time** graph and prove
     nothing about runtime resolution
2. Add the same two lines to the per-feature checklist at the end of
   `docs/ide-roadmap.md`.
3. Ensure `AGENTS.md` points at this plan and at the cookbook, so
   `agent-instructions` pulls them into context automatically.

**Done when**
- [ ] The cookbook names the manifest for each plane.
- [ ] `AGENTS.md` references this document.

---

## Part 3 — Phase 1: lock in what was just fixed

Commit `242fc2e647` fixed the defects but added no tests, so nothing prevents
regression.

### T1-A · Tests for the four revived features

**Steps**

1. `packages/routing/model-router/tests/` — the load-bearing claim is waterfall
   ordering: a host-plane listener must be **outermost**, so its override wins
   over `installModelSelection`. Assert it directly. The idiom already exists in
   `packages/core/agent/tests/model-selection.spec.ts:24`, which drives
   `agent/request` by hand, and
   `packages/compaction/compaction-basic/tests/compaction-loop-repro.spec.ts:220`,
   which registers a competing listener. Also cover: `'next'` hint survives a
   same-step retry; `'next'` hint is dropped on the following step; unknown
   provider returns a tool string and never reaches dispatch.
2. `packages/memory/memory-local/tests/` — `assertSafeSlug` rejects `../`,
   absolute paths, and separators; cross-session visibility; per-workspace
   isolation; `forget_memory` removal.
3. `packages/storage/tool-artifact-publish/tests/` — object path is prefixed by
   the real session id, not `default/`, with a stubbed `fetch`.
4. `packages/fs/tool-notebook/` already has real coverage; add only a mount
   assertion if T1-B lands.

**Done when**
- [ ] Each package has a `tests/` directory matching `knip.json`'s `tests/**/*.spec.ts` pattern.
- [ ] Reverting any fix from `242fc2e647` fails at least one named test.

### T1-B · READMEs for the two new packages

`model-router` and `tool-artifact-publish` have none, and the repo gates require
`## Model Experience` (exactly three ordered H4s —
`scripts/verify-package-readme-model-experience.ts:419`) plus
`## Known Limitations and Deferred Work`
(`scripts/verify-package-readme-limitations.ts:15`). Neither package is in either
allowlist. Record the real known gaps: no per-tool routing, no model-id
validation, hardcoded 24h artifact TTL.

### T1-C · Reconcile the roadmap with reality

`docs/ide-roadmap.md` still points T2-3 at `packages/artifact/artifact-s3/`, has
no Tier 2 checkbox ticked, and its baseline table is stale in both directions —
it omits shipped work and credits five packages the model cannot reach
(`tool-lsp`, `tool-terminal`, `tool-session-query`, `tool-notebook`,
`dsh-schedule` are in zero shipped compositions). Correct it or supersede it with
this document.

### T1-D · Close the T2-3 credential and replay gaps

- `src/index.ts:25-26` reads `process.env` directly; the roadmap required
  `ctx.credentials`. The value is a **service-role** key (full RLS bypass) held
  for the process lifetime with no rotation or redaction seam.
- Error paths at lines ~80 and ~95 interpolate raw Supabase response bodies into
  thrown messages that land in the session log — a credential-adjacent leak with
  no scrubber.
- There is no `presentResult` and no `output.presentationMeta`, so the URL exists
  only in model-facing text and **no card survives replay**. The roadmap's steps
  4–6 (an `ArtifactResultView` in `packages/core/tools/src/presentation.ts` plus
  an `ArtifactBlock.tsx` mirroring `AppPreviewBlock`) were skipped.
- `expiresIn: 86400` is hardcoded, so "TTL works as configured" cannot hold.

---

## Part 4 — Phase 2 onward: new capability, in value order

### T2-A · Git ergonomics — the biggest daily gap  ★ highest value

Verified: no git package, no git library, no git argv construction, and **zero
git guidance in any prompt text**. The only git-adjacent strings are a root
marker, a VCS glob-exclude, a `GIT_*` env scrub, and `GIT_PAGER=cat`.

**Phase 0 (~2 hours, do immediately — independent of everything else).**
A `ctx.systemPrompt.section({ name: 'workflow:git', order: 150 })` covering
status/diff/log inspection before acting, commit-message conventions,
`gh pr create`, and "never commit or push unless asked." Git already *works*
through `bash`/`pwsh`; only the ergonomics are missing, so this captures a large
fraction of the value for almost no effort.

**Phase 1 (3–5 days).** `packages/git/tool-git` with `git_status`, `git_diff`,
`git_log`, `git_commit`, `git_branch` via `defineTool`, shelling out through
`ctx.subprocess` with explicit argv. Copy
`packages/fs/tool-fs-search/src/grep.ts`, which is exactly this pattern for
ripgrep. **Payoff:** `packages/core/tools/src/presentation.ts` already ships
`card: 'diff'` with `FileDiff[]`, so `git diff` renders as a real diff card for
free. New group, so `tsconfig.base.json` needs both wildcards plus a
`tsconfig.host.json` reference — and per T0-5, `packages/git/tool-git` in
`apps/cli/package.json` and rows in both presets.

### T2-B · Context-remaining in the prompt (hours)

`token-meter` already computes `contextPressure` (`pressureTokens` /
`contextWindow`) but nothing surfaces it to the model, so it cannot pace itself
before auto-compaction at 0.8. Contribute via `ctx.systemPrompt.context()` —
**not** `section()`, which would invalidate the cache prefix every turn. Follow
`packages/sandbox/sandbox-policy/src/index.ts:113`, which does exactly this for a
churning value. The callback is synchronous; read the projection snapshot.

### T2-C · `@`-file mentions in the composer (1–2 days)

Infrastructure is complete: `ctx.inputTriggers.registerSource`, with working
examples at `packages/client/ui-skill/src/client/index.ts:185` and
`packages/client/ui-subagent/src/client/index.ts:97`. Registered `@` sources are
currently skills/subagents/plugins only. Add a filesystem source backed by the
existing `host.listDirectory` RPC. Pure reuse of a finished seam.

### T2-D · Persistent approval grants (3–5 days)

`allowed-once` is the only grant (`packages/interaction/user-approval/src/types.ts:29`),
so every sandbox escalation re-prompts. Add `allowed-session`, optionally
persisted under the existing `permission` settings namespace. **Caution:** this
widens the `ApprovalOutcome` union, which is invariant-checked in
`packages/interaction/user-approval/src/invariant.ts` and mirrored in
`packages/client/connection/src/client/fixture.ts` — breaking across implementors
and security-relevant.

### T2-E · File-based slash commands (~2 days)

`ctx.commands.register` exists; only discovery is missing. Mirror
`packages/skill/skill-filesystem/src/index.ts:246`, which already walks
`.dsh/skills` and `.agents/skills`, and point the same walker at
`.dsh/commands/*.md`.

### T2-F · Decisions required before these can start

Each needs an owner call, not just implementation:

| Item | The decision |
|---|---|
| `tool-terminal` | Injects a `terminals` service composed **nowhere**. Needs host rows for the service plus a platform-gated backend. |
| `tool-session-query` | `session-query-sqlite` ships `openAt: never`, `path: ':memory:'` deliberately. Mounting the tool without enabling FTS gives the model a tool that always errors. Enabling it is a perf and privacy choice. |
| `web_fetch` | `fetch: false` in base and both presets, no fetch provider mounted — deliberate SSRF posture. Enabling needs a provider plus a policy. |
| `tool-lsp` | Mounted nowhere, and diagnostics are **not** available: `lsp-stdio/src/connection.ts:254` discards server notifications and the seam's types exclude diagnostics by design. Surfacing them is ~a week, not a config row. |
| T3-3 adapters | Never started; the phantom `packages/llm/llm-anthropic` was deleted. Do you want Anthropic/OpenAI routes at all? |

---

## Phase 3 — T2-1 VS Code, as its own project (5–10 days)

Not a fix. The extension spawns `dsh web` and iframes its HTTP UI
(`apps/vscode/src/DshSession.ts:35`) instead of driving the SDK server per the
roadmap's step 2, so it has **no protocol-level access to tool results** and
therefore cannot intercept `edit` results even in principle. Consequences:

- `ChatPanel.ts:119-127` waits for `dsh.openFile` / `dsh.showDiff` messages that
  **nothing in the web client ever posts** (zero hits repo-wide). Path-jump and
  diff review are unreachable dead code.
- The second listener registers `dsh:editProposal` on the outer webview window,
  which a CustomEvent inside a cross-origin iframe cannot reach — structurally
  impossible, not merely unwired.
- `spawn('dsh', ...)` ENOENTs on Windows, where the shim is `dsh.CMD`; and `dsh`
  is not a declared dependency of `apps/vscode`, so it is assumed on global
  `PATH`.
- `restartServer` disposes its output channel then writes to it, and the iframe
  `src` is baked at construction, so a restart on a new port points at a dead one.
- No `activeTextEditor` / selection context and no diagnostics reach the agent.

Rewrite against `packages/sdk/client` (reference:
`packages/sdk/server/src/server.ts`, which calls `ctx.agents.create`). Making it
compile — done in `242fc2e647` — made it *installable*, not *functional*.

**Trap: do not build `/rewind`.** `session.fork` rewinds the conversation, but
nothing snapshots files — there is no `undo_edit` and `fs-local/src/win32.ts:20`
passes `backup: null` to `ReplaceFileW` explicitly. A rewind that forks the
transcript while the working tree stays mutated is actively misleading. Doing it
properly means content-addressed snapshots on every edit: weeks. **T2-A is the
honest substitute** — give the model real git instead.

---

## Part 5 — Executing this with DSH, and where model strength matters

### The operating rule

A task in this plan is complete only when
`npm run typecheck && npm run lint && npm run test && pnpm run hygiene` all pass.
Not when the code looks right. Not when the build is green — the four dead
plugins all built green.

### Why Phase 0 is the whole answer to "can DSH do this reliably"

Every task in Phases 1–3 is mechanically verifiable *once Phase 0 lands*:

- Adding a plugin → `verify-cordis-config` names a missing dependency by row id
- Adding a package → `constraints` + `verify-package-invariants` name the field
- Adding a tool → `doc-sync` fails loud on an uncovered `ctx.<key>`
- Any regression → a named test fails

That converts each task from "requires the model to remember an invisible
convention" into "requires the model to read an error message and act." Mid-tier
models are reliable at the second and unreliable at the first. **This is why
Phase 0 is the unlock, and why skipping it means no model choice saves you.**

### Where a stronger model is genuinely worth it

| Work | Model need |
|---|---|
| T0-1, T0-4, T0-5, T1-A/B/C, T2-B, T2-C, T2-E | **Mid-tier is fine.** Mechanical, gated, single-seam, existing pattern to copy. |
| T0-2, T0-3, T1-D, T2-A phase 1, T2-D | **Strong model preferred.** Cross-package contracts, breaking unions, security reasoning, or an unresolved diagnosis. |
| Phase 3 (T2-1 rewrite) | **Strong model required.** Cross-cutting protocol architecture with no existing pattern in-repo, plus a wrong-by-design starting point that must be recognized as such rather than patched. |

### Practical guidance for driving DSH through this

1. **One task per session.** These tasks touch adjacent files; batching them
   makes a failed gate ambiguous about which change broke it.
2. **Make the gate the prompt.** "Add X, then make `pnpm run hygiene` pass"
   outperforms "add X correctly," because the second has no closing feedback loop.
3. **Never accept green typecheck as done.** It is precisely the signal that
   misled here.
4. **Order matters.** T0-1 before anything that mounts a plugin; T0-3 before
   anything claiming test coverage.
5. **Escalate on diagnosis, not on volume.** The tasks that need a strong model
   are the ones where the *problem* is unclear, not the ones where there is a lot
   of typing.

---

*Written 2026-08-19 after the full-tier audit. Fixes landed in `242fc2e647`.
Owner: lkelly@corvusconstruction.com*
