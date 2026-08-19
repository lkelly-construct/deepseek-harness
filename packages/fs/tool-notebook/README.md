# @deepseek-ai/dsh-tool-notebook

Standalone model-facing `notebook_edit` over `ctx.fs`: cell-indexed read, insert, replace, and delete for Jupyter (`.ipynb`) notebooks. Not mounted by any shipped preset by default — compose it into a preset only for a workflow that actually edits notebooks.

## Config

| Key | Default | Meaning |
|---|---:|---|
| `description` | Notebook command guide | Model-facing tool description. |

## Tool

`.ipynb` is nbformat JSON: a top-level `cells` array, each cell carrying `cell_type`, `source` (a string or list-of-lines), and `metadata`. The tool parses that JSON directly through `ctx.fs.readText`/`writeText` — no notebook library. `read` with no `index` returns a one-line-per-cell overview (index, type, first line of source); with `index` it returns that cell's full source. `insert` accepts an index up to the current cell count (append) and an optional `cell_type` (defaults to `code`); a new code cell gets empty `outputs` and a null `execution_count`, matching what a real kernel would produce for an unexecuted cell. `replace` overwrites a cell's source and, when `cell_type` changes away from `code`, drops the now-stale `outputs`/`execution_count` fields rather than leaving code-only metadata on a markdown or raw cell. `delete` removes a cell. Every mutation is a whole-file `ctx.fs.writeText` guarded by the read version, so a concurrent external edit is reported as a stale-version conflict rather than silently overwritten.

## Model Experience

### Tool schema

#### What the model sees

The generated [`notebook_edit` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-notebook), including the configured `description`. The plugin contributes no standalone system-prompt section.

#### Token effect

Fixed schema cost while `notebook_edit` is visible.

#### KV Cache effect

Prefix-stable while the configured description and schema remain unchanged.

### Tool results

#### What the model sees

`read` returns a one-line-per-cell overview or one cell's full source as plain text. Mutations return a concise confirmation naming the affected index and path.

#### Token effect

Data-dependent on notebook size and the read command's scope (overview vs. one cell); mutations are a fixed-size confirmation.

#### KV Cache effect

Append-only tool results follow the reusable request prefix.

## Known Limitations and Deferred Work

- No `run` command: the tool edits notebook JSON only. Executing a notebook (e.g. `jupyter nbconvert --to notebook --execute --inplace`) is out of scope here; route that through a Bash/shell tool instead.
- Malformed JSON, a missing `cells` array, or a non-object cell reports a clear tool error naming the file instead of throwing an uncaught parse exception.
- Cell `source` is always normalized to nbformat's list-of-lines form on write, regardless of whether the file previously stored it as a single string.
- Every mutation goes through `ctx.fs.writeText` guarded by the read version; enforcement (sandboxing, read-only mode) is delegated entirely to the mounted filesystem and policy plugins, matching `tool-str-replace-editor`.
