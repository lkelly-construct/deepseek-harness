# @deepseek-ai/dsh-tool-git

The **model-facing git tools**: `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, plus shadow-worktree tooling — `git_worktree` (explicit add/list/remove) and `git_shadow_run` (create, validate, roll back). Every executable git invocation goes through `ctx.subprocess.spawn` with bounded collected output (a 4 MB stdout tail, a 64 KiB stderr tail) and the calling tool's cancellation signal — never a raw `child_process` fork.

## Tool wiring

The package is a function plugin: `name`, `inject`, `Config`, `apply`. It injects `tools`, `subprocess`, and `systemPrompt`.

```ts ignore-check
await ctx.plugin(ToolGit) // this package — registers the git_* tools
```

## Config

All keys are optional; the defaults are the shipped shadow-run caps.

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `30000` | Cooperative tool-call timeout budget (ms) for `git_shadow_run` and `git_worktree`, capped at the timeout seam's `MAX_TIMER_DELAY_MS`. |
| `maxStdoutBytes` | `65536` | Max stdout bytes retained (tail) for one shadow-run validation command. |
| `maxStderrBytes` | `65536` | Max stderr bytes retained (tail) for one shadow-run validation command. |
| `graceMs` | `3000` | Terminate-escalation grace (ms) handed to every spawned process. |

## Tools

| Tool | Arguments | Behavior |
|---|---|---|
| `git_status` | `workdir?` | Working-tree status; run before any `git_commit`. |
| `git_diff` | `ref?`, `staged?`, `path?`, `workdir?` | Unified diff, optionally scoped and compared to a ref. |
| `git_log` | `n?`, `branch?`, `path?`, `workdir?` | Recent commit history (hash, author, date, subject). |
| `git_commit` | `message`, `all?`, `workdir?` | Create a commit; only staged changes unless `all: true`. |
| `git_branch` | `name?`, `delete?`, `workdir?` | List, create, or delete branches. |
| `git_worktree` | `operation`, `path?`, `branch?`, `base?`, `workdir?` | Manage **shadow** worktrees: add/list/remove, confined to `<git dir>/dsh-shadow/`. |
| `git_shadow_run` | `base?`, `command`, `keepWorktree?`, `workdir?` | Create a shadow worktree, run a validation command inside it, roll it back. |

Field names are snake_case to match the harness tool-schema convention. A non-zero git exit is reported as `[exit code: N]` at the end of the output, matching the bash tool.

## Shadow worktrees: design

**Shadow root scheme** — a shadow worktree is created under the repository's git directory at `<gitDir>/dsh-shadow/<name>` (resolved via `git rev-parse --git-dir`), not at a sibling of the working tree. The shadow root is a security boundary: `git_worktree add` and `git_shadow_run` reject any model-supplied path that escapes it — an absolute path outside the root, a parent-traversal (`..`) segment, glob metacharacters, or the root itself — before any git invocation. `git_worktree`'s add accepts only a single plain directory name; removal refuses any path outside the shadow root, so the main working tree can never be a removal target. Shadow branches are namespaced `dsh-shadow/<name>` (or `dsh-shadow/<uuid>` for shadow runs), so branch cleanup is always recognizable.

**`git_shadow_run` rollback** — the flow is: create the shadow worktree at a UUID path with a `dsh-shadow/<uuid>` branch; run the command inside it (bounded stdout/stderr tails, `[exit code: N]` marker on non-zero exit); then roll back with `git worktree remove --force` followed by `git branch -D dsh-shadow/<uuid>`. The rollback runs unconditionally — on success, on a failing validation command, on a spawn-level error, and on an aborted call — and uses its own abort signal so the caller's timeout or abort never cuts cleanup short. `keepWorktree: true` leaves the worktree and branch in place for inspection; a rollback that itself fails surfaces the leftover worktree path and branch name in the tool error for manual cleanup.

The shadow checkout of a commit never contains the main tree's uncommitted edits or untracked files, so `git_shadow_run` is the model-facing way to run typecheck, build, test, or formatter commands that must operate on a clean checkout.

## Model Experience

### System prompt

#### What the model sees

The `tool:git` section lists the `git_*` tooling rules for status/diff/commit/branch and a dedicated `## Shadow worktrees` block: when to use `git_shadow_run`, that it never touches the main working tree, and that failures roll back.

#### Token effect

Fixed guidance cost per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged.

### Tool schemas

#### What the model sees

The generated `git_*` schemas, registered by this package. `git_worktree`'s `operation` is an enum of `add`/`list`/`remove`; `git_shadow_run`'s `command` is a required array of argv strings.

#### Token effect

Fixed schema cost on every request in that tool view.

### Tool results

#### What the model sees

The plain git output (`git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`), a readable normalized `path abbreviated-head branch` listing for `git worktree list`, and for `git_shadow_run` the output tail plus `[exit code: N]` when the validation command exited non-zero. Structured values expose `exitCode`, `worktreePath`, `outputTail`, `branch`, and `rolledBack` on the shadow-run result.

#### Token effect

Output is capped (`maxStdoutBytes`/`maxStderrBytes` tail for shadow runs), and a successful call is append-only in the session history.

## Known Limitations and Deferred Work

- **Shadow worktrees require a git-capable filesystem.** The shadow root lives inside `.git`, so `git_worktree`/`git_shadow_run` only work in ordinary repositories, and git itself must be on the executable path of the subprocess service.
- **`git_shadow_run` keeps the main tree clean but not the object store** — a validation command that commits in the shadow leaves reachable objects behind; branch names are cleaned but the objects themselves are GC'd only by git's normal maintenance.
- **No shadowing of the shadow** — `git_shadow_run` does not nest; a command inside the shadow that calls `git_shadow_run` recursively is not guarded.