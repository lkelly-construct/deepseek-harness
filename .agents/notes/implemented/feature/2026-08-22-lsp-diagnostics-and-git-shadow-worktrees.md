# Agent Note: LSP diagnostics operation and git shadow worktrees

Status: implemented

## Problem

Two capability gaps surfaced in the [system architect self-audit](2026-08-22-text-pdf-file-attachments.md): the agent could navigate LSP symbols but had no structured compiler-diagnostic view, and it could mutate the working tree only directly, with no sandboxed branch-off-and-validate loop. Both asked for additive capabilities that must not disturb the established seams.

The LSP seam exposed exactly four semantic operations (`goToDefinition`, `findReferences`, `goToImplementation`, `hover`); a `diagnostics` query is a different operation with a different result union (locations vs severity-coded messages), so it could not ride the existing `locations`/`hover` variants. The git capability had single-purpose `git_*` tools; a shadow-worktree validation flow needed a confined, rollback-safe primitive.

## Decision

### LSP: a fifth closed-union operation `diagnostics`

`LspOperation` gains `'diagnostics'`; `LspQueryResult` gains `{ kind: 'diagnostics'; diagnostics: readonly LspDiagnostic[]; resolvedWorkspaceUri }`. `LspDiagnostic` is `{ severity: 1|2|3|4; code?: string; message: string; range: LspRange }` in LSP severity order (1 error … 4 hint). `position` stays required on `LspQueryRequest` for seam uniformity; providers ignore it for diagnostics and the tool guidance says so. Exhaustive switches across the seam, `lsp-stdio`, and `tool-lsp` gained the new arm with `assertNever` defaults, so adding the operation was compile-enforced across the full seam.

`lsp-stdio` implements the operation by pull when the server advertises `diagnosticProvider` (`textDocument/diagnostic`, position omitted from params), otherwise it buffers `textDocument/publishDiagnostics` notifications per document URI and returns the freshest published batch after `didOpen`, bounded by `killGraceMs`; a silent server yields `[]`. Severity and `code` normalize to the seam shape (`string | number` → string).

### Offline `typecheck` tool (separate package)

A new `packages/lsp/tool-typecheck` package implements an explicit `typecheck` tool over `ctx.subprocess`: it runs `tsc --noEmit --pretty false` and parses `file(line,col): error TSxxxx: message` (including folded multiline messages) into the same `LspDiagnostic` shape at severity 1. It is an explicit separate tool, never routed through `ctx.lsp` — the seam stays an LSP-server abstraction with no compiler coupling. Registered in `tsconfig.host.json`; documented as pinned to the TypeScript `--pretty false` format.

### Git: `git_worktree` and `git_shadow_run`

`git_worktree` (`add`/`list`/`remove`) and `git_shadow_run` join the `git_*` tool family in `packages/git/tool-git`. Both confine every worktree to a shadow root `<gitDir>/dsh-shadow`, derived via `git rev-parse --git-dir`; a model-supplied path that escapes — absolute, parent-traversal, glob metacharacters, or the root itself — is rejected before any git invocation. Removal refuses any path outside the shadow root, so the main working tree is never a removal target, and a removed shadow worktree has its `dsh-shadow/<name>` branch deleted after the worktree removal.

`git_shadow_run` creates a UUID-named shadow worktree at the current HEAD (or a caller `base`), runs an argv command with `cwd` = worktree (bounded stdout/stderr tails), and unconditionally rolls it back (`git worktree remove --force` + `git branch -D`) unless `keepWorktree`, returning `{exitCode, worktreePath, outputTail, branch, rolledBack}`. Execution goes through `ctx.subprocess` with the existing timeouts and abort-signal discipline; `Config` owns the bounds (no hardcoded tunables).

## Alternatives considered

- **Route diagnostics through `ctx.lsp` with an offline fallback inside the provider.** Rejected: the seam is an LSP-server capability; folding a `tsc` subprocess fallback in would couple the provider registry to a specific compiler when other code generators (eslint, go vet) are equally plausible diagnostics sources. The explicit separate `typecheck` tool keeps `ctx.lsp` LSP-only while still offering offline structured diagnostics.
- **`git worktree` as a single opaque tool.** Rejected: add/list/remove have distinct model-visible intents and error modes; separate `add`/`list`/`remove` arms with a structured result preserve the per-operation schema, matching the existing `git_*` tool style.
- **Drop the shadow branch on remove.** Reversed: `git worktree remove --force` removes the worktree but leaves a dangling shadow branch unless deleted; B2's `remove` deletes `dsh-shadow/<name>` branches after removal so a failed `git_shadow_run` cannot leak branches.

## Testing

- `packages/lsp/lsp/tests/lsp.spec.ts`: diagnostics routing + position preserved; new arm compiles.
- `packages/lsp/lsp-stdio/tests/translate.spec.ts` + `lifecycle.spec.ts` + `fixture-server.ts`: pull, push-fallback, silent-server → `[]`, pull-null → `[]`, normalization suites (severity default, code coercion, malformed rejects as `LSP_MALFORMED_RESPONSE`).
- `packages/lsp/tool-lsp/tests/render.spec.ts` + `tool-lsp.spec.ts`: five-operation schema, pinned diagnostics render.
- `packages/lsp/tool-typecheck/tests/tool-typecheck.spec.ts`: fake-subprocess `tsc` output parsing including folded multiline messages.
- `packages/git/tool-git/tests/worktree.spec.ts`: 8 real-`git init` integration tests — add exists, list, remove cleans branch, shadow-run success/failure rollback, main tree untouched, path-local escape rejected.
- Gates: `tsc -b tsconfig.host.json` (exit 0), `tsc -b tsconfig.client.json` (exit 0), `vitest run packages/lsp packages/git` (255 passed, 3 pre-existing Windows symlink EPERM failures in `host.spec.ts` unrelated to this change), `oxlint` clean on both trees.

## Consequences

- The `lsp` tool now answers structured compiler-style diagnostics in the session instead of forcing the model to shell out to `tsc -b` with unstructured output; a `typecheck` tool provides the same contract offline.
- The git tool family can validate a proposed change from a clean HEAD without touching the main working tree; a failed `git_shadow_run` rolls back atomically, so the agent cannot half-apply a change into a shadow worktree.
- The `lsp-definition` snapshot fixture is stale on master (pinned header predates the `edit_file` tolerant alias added 2026-08-20); it replays red in CI on master. Re-recording needs a live API key and is tracked separately from this change.
- `keep_worktree: true` intentionally leaks a worktree + branch; the README documents it as the escape hatch for iterative debugging.
