# Preview the app you are building

The Web UI can render the app an agent is building in a live, sandboxed window. Once the agent starts the app's dev server, it surfaces the running `http://localhost:<port>` URL as an `app-preview` card in the conversation. You look at the running app and ask for adjustments, and the agent edits the code and re-surfaces the preview.

## What the preview is

An app-preview card is a sandboxed iframe that loads the running app's dev-server URL (`src`, not a static snapshot). It allows scripts and same-origin access so the app can load its own assets, but blocks popups and top-level navigation. The URL-facing toolbar includes a copy-URL control.

This is the live-app counterpart of the static [HTML preview card](../develop/basic/tool.md). Use the HTML preview for page mockups and static snippets; use the app preview for a real running application with scripts and assets.

## Prerequisites

- A completed [model configuration and workspace setup](./index.md).
- A project with a runnable dev server (for example a Vite or `npm run dev` app).
- A preset that mounts the `render_app_url` tool (`@deepseek-ai/dsh-tool-app-preview`).

## How the agent uses it

1. The agent runs the dev server through a bash tool.
2. The server prints `http://localhost:<port>`; the agent calls `render_app_url` with that URL.
3. The GUI loads the URL in the sandboxed iframe. You see the running app.
4. You ask for changes; the agent edits the code and calls `render_app_url` again (if the dev server hot-reloads, the already-open iframe refreshes on its own).

The tool only surfaces an existing URL. It does not start, probe, or keep the dev server alive — that is the agent's job. If the server is not reachable, the card shows a connection error.

## Configuring the tool in a preset

The `@deepseek-ai/dsh-tool-app-preview` package registers the `render_app_url` tool on `ctx.tools`. Mount it in an agent preset the same way as any other tool row:

```yaml
- id: tool-app-preview
  name: '@deepseek-ai/dsh-tool-app-preview'
```

See [agent preset configuration](../develop/basic/config.md) for how presets mount tools.

## Security

The preview iframe is sandboxed. The default `allow-scripts allow-same-origin` lets a real app reference its own scripts and styles, but the sandbox is not a security boundary against the app's server — the app's own code runs with the network access of the page that loaded it. Load only apps you trust.

## Known limitations

- The preview depends on the dev server being reachable when the iframe loads; it does not keep the server up.
- Port forwarding through a remote sandbox (for example over the E2B POC) is not wired in; the dev server runs locally.
- The tool does not validate that the URL is a localhost address before surfacing it.