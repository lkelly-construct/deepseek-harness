# Build a tool

This tutorial adds a `greet` tool to the Web UI. Complete [Your first plugin](./) first and keep its `scratch-plugin` directory.

## Create the tool plugin

Replace `scratch-plugin/src/my-plugin.ts` with:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))
}
```

`inject` makes Cordis wait for the tool registry. `defineTool` infers and validates `args` from `parameters`; `execute` returns the canonical value declared by `output.schema`, and `output.render` converts that value to model-facing content.

## Run and call the tool

Restart the development command if it is not running:

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

Port 3080 is the default for every `dsh web` instance, including a Web session you're already using to follow this tutorial. Add `--port 3081` (or another free port) to the command above if 3080 is taken, or you'll hit `EADDRINUSE`.

If this command runs inside a sandboxed shell tool rather than a plain terminal, `tsx`'s esbuild service spawning a worker process can fail with `spawn EPERM` under a confining sandbox mode — see [Process Sandbox](../../subsystems/sandbox.md). Run it from an unconfined terminal, or under a permission preset that allows process spawn, if you hit that.

Open `http://127.0.0.1:3080` (or whichever port you chose) and ask: `Use the greet tool to greet Ada.` The model can call `greet` and receives `Hello, Ada!` as the tool result.

## Next steps

- [Plugin configuration](./config.md) — make the greeting configurable.
- [Tool authoring reference](../../../cookbook/adding-a-tool.md) — look up nested schemas, canonical values, background work, policy hooks, Code Mode, and UI cards.
- [Capability layering](../practice/) — split a replaceable capability into Service Definition, Service Provider, and Consumer packages.
