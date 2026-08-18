# Supabase agent preset

A coding agent with the live app preview tool plus a Supabase MCP bridge
(`mcp__supabase__*` tools) for inspecting and working with your Supabase
project.

## Environment variable

Requires `SUPABASE_ACCESS_TOKEN` in the environment. The preset passes it to
the MCP server process via its `env` config using `!!js
process.env.SUPABASE_ACCESS_TOKEN` — there is no `${VAR}` interpolation in
preset YAML, and the value never appears on the process argv.

Without the token the harness still starts: `failOnStartupError: false` means
a failed initial connection logs a warning and the server's tools are simply
absent. The MCP client reconnects with backoff after a lost connection.

## How a user selects this preset

There is no `--preset` CLI flag. Preset selection happens on a blank session:

- **Per-session UI picker** — choose `supabase` from the preset picker while
  the session is blank (after a turn the picker is locked).
- **User default** — set the `agent-presets` settings namespace `default`
  field to `supabase`; new sessions then default to it.
- **Composition default** — the `agent-presets` plugin's own `default` config
  field.

`session.create` also accepts an `agentPreset` value.