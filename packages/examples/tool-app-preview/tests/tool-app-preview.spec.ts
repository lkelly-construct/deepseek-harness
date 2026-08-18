import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'

import * as tool from '../src/index.ts'

/**
 * The registered `render_app_url` definition under test. `defineRenderAppUrlTool`
 * is exported precisely so the presenters and pass-through view are asserted
 * directly without composing a registry or Loader.
 */
const definition = tool.defineRenderAppUrlTool()

/** Loose execute signature: `render_app_url` ignores its execution context, so none is provided. */
type LooseExecute = (args: unknown, exec: unknown) => Promise<unknown>

// Captured bound reference: the registry invokes execute with its own `this`;
// a bare property reference would trip the unbound-method lint rule in the tests.
const execute: LooseExecute = definition.execute.bind(definition) as unknown as LooseExecute

function result(meta: NonNullable<ToolResult['meta']>): ToolResult {
  return { content: [{ type: 'text', text: 'Rendered http://localhost:3000 as a live app preview card.' }], isError: false, meta }
}

describe('dsh-tool-app-preview', () => {
  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    // A default export would make Loader unwrap only apply and drop `inject`.
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-app-preview')
    expect(tool.inject).toEqual(['tools'])
    expect(typeof tool.apply).toBe('function')
  })

  it('registers a `render_app_url` tool whose schema declares url/title/width/sandbox', () => {
    expect(definition.name).toBe('render_app_url')
    const parameters = definition.parameters as { properties?: Record<string, { type: string }>; required?: string[] }
    expect(Object.keys(parameters.properties ?? {})).toEqual(['url', 'title', 'width', 'sandbox'])
    expect(parameters.properties?.url).toMatchObject({ type: 'string' })
    expect(parameters.required).toEqual(['url'])
    expect(parameters.properties?.width?.type).toBe('integer')
  })

  it('apply registers the render_app_url tool on a composing ctx.tools', () => {
    const registered: unknown[] = []
    const ctx = {
      tools: { register: (def: unknown) => { registered.push(def); return () => {} } },
    } as unknown as Context
    tool.apply(ctx)
    expect(registered).toHaveLength(1)
    expect((registered[0] as ToolDefinition).name).toBe('render_app_url')
  })

  it('execute returns the pass-through view, omitting undefined width/sandbox', async () => {
    const value = await execute({ url: 'http://localhost:3000' }, {})
    expect(value).toEqual({ url: 'http://localhost:3000' })
  })

  it('execute carries width and sandbox through when provided', async () => {
    const value = await execute({ url: 'http://localhost:8080', width: 640, sandbox: 'none' }, {})
    expect(value).toEqual({ url: 'http://localhost:8080', width: 640, sandbox: 'none' })
  })

  it('presentResult returns the app-preview card with the view url', () => {
    expect(definition.presentResult?.({ url: 'http://localhost:3000' }, result({ url: 'http://localhost:3000' })))
      .toEqual({ card: 'app-preview', url: 'http://localhost:3000' })
  })

  it('presentResult passes width and sandbox through the card when present', () => {
    expect(definition.presentResult?.({ url: 'http://localhost:3000' }, result({
      url: 'http://localhost:3000', width: 480, sandbox: 'none',
    }))).toEqual({ card: 'app-preview', url: 'http://localhost:3000', width: 480, sandbox: 'none' })
  })

  it('presentResult falls back to a generic card when the view meta is missing or invalid', () => {
    const withoutMeta = { ...result({ url: 'http://localhost:3000' }) }
    delete withoutMeta.meta
    expect(definition.presentResult?.({ url: 'http://localhost:3000' }, withoutMeta))
      .toEqual({ card: 'generic', content: [{ type: 'text', text: 'Rendered http://localhost:3000 as a live app preview card.' }] })
    expect(definition.presentResult?.({ url: 'http://localhost:3000' }, result({ url: 42 })))
      .toEqual({ card: 'generic', content: [{ type: 'text', text: 'Rendered http://localhost:3000 as a live app preview card.' }] })
  })

  it('presentationMeta projects the view onto result.meta for replay', () => {
    expect(definition.output.presentationMeta?.({ url: 'http://localhost:3000', width: 600 }, { url: 'http://localhost:3000', width: 600 }))
      .toEqual({ url: 'http://localhost:3000', width: 600 })
  })

  it('output.render reports the rendered URL', () => {
    const blocks = definition.output.render({ url: 'http://localhost:3000' }, { url: 'http://localhost:3000' })
    expect(blocks).toEqual([{ type: 'text', text: 'Rendered http://localhost:3000 as a live app preview card.' }])
  })
})
