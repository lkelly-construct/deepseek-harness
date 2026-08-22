# dsh-tool-typecheck

The model-facing **`typecheck` tool**: an offline TypeScript diagnostics fallback. It runs `tsc --noEmit --pretty false` through the subprocess capability and parses the `file(line,col): error TSxxxx: message` lines into the LSP seam's [`LspDiagnostic`](../lsp/README.md) shape (severity 1, the `TSxxxx` code, a zero-width range at the reported position). It is a SEPARATE, explicit tool — it never routes through `ctx.lsp`, so it works with **no language server and no network**. It requires no API key.

## Model Experience

- **Tool:** `typecheck` — one read-only tool; an optional `project` string selects the `tsconfig.json` to check (defaults to `tsconfig.json` at the session workspace root). There is no per-file mode; the compiler checks the whole project named by the tsconfig.
- **Input:** session workspace cwd (required, no fallback — mirrors tool-lsp; a missing cwd fails the call).
- **Output:** the seam's `{ kind: 'diagnostics', diagnostics, resolvedWorkspaceUri }` value; the plain-text render is `line:character error: message [TSxxxx]` lines, identical to tool-lsp's `diagnostics` operation rendering, so the model sees one consistent diagnostic vocabulary. A clean exit renders `No diagnostics.`
- **Guidance:** the stable prompt section says to prefer an LSP server's diagnostics when available and use `typecheck` as the offline fallback.
- **Failure:** a nonzero `tsc` exit with no parsed diagnostics (for example, a config error) fails the call carrying the stderr excerpt; a missing `tsc` executable and cancellation/kill also fail loud — never a silent empty result.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `maxResultChars` | `16000` | Complete rendered-result cap including truncation metadata |
| `timeoutMs` | `120000` | Tool-call timeout budget for one `tsc` run |
| `maxOutputBytes` | `1000000` | Collected `tsc` stdout cap (tail retained) |
| `maxStderrBytes` | `64000` | Retained `tsc` stderr tail cap |

## Deployment

The tool spawns the workspace's own TypeScript through the real `node` executable (`node <typescript/bin/tsc> --noEmit --pretty false -p <project>`) with no shell layer. It never execs a `tsc` PATH shim; on Windows those resolve to `.cmd`/`.ps1` wrappers the subprocess provider cannot exec directly. `typescript/bin/tsc` is resolved from the session workspace root (via `createRequire`), so the workspace must have TypeScript installed; the compiled project is whatever the tsconfig names.

## Known Limitations and Deferred Work

- The parse is keyed to the `--pretty false` output form of the TypeScript compiler; other compilers or flags are not supported.
- Only whole-project checks are supported (the `-p` form); per-file incremental or watch mode is deferred.
- The tool reports errors only (severity 1): `tsc --noEmit` does not emit warnings, so the seam's warning/information/hint severities never appear from this tool.