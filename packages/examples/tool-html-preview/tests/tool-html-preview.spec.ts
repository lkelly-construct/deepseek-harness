import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'

import * as tool from '../src/index.ts'

/**
 * The registered `render_html` definition under test. `defineRenderHtmlTool`
 * is exported precisely so the presenters and pass-through view are asserted
 * directly without composing a registry or Loader.
 */
const definition = tool.defineRenderHtmlTool()

/** Loose execute signature: `render_html` ignores its execution context, so none is provided. */
type LooseExecute = (args: unknown, exec: unknown) => Promise<unknown>

// Captured bound reference: the registry invokes execute with its own `this`;
// a bare property reference would trip the unbound-method lint rule in the tests.
const execute: LooseExecute = definition.execute.bind(definition) as unknown as LooseExecute

function result(meta: NonNullable<ToolResult['meta']>): ToolResult {
  return { content: [{ type: 'text', text: 'Rendered 0 bytes of HTML to the preview card.' }], isError: false, meta }
}

describe('dsh-tool-html-preview', () => {
  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    // A default export would make Loader unwrap only apply and drop `inject`.
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-html-preview')
    expect(tool.inject).toEqual(['tools'])
    expect(typeof tool.apply).toBe('function')
  })

  it('registers a `render_html` tool whose schema declares html/title/width/sandbox', () => {
    expect(definition.name).toBe('render_html')
    const parameters = definition.parameters as { properties?: Record<string, { type: string }>; required?: string[] }
    expect(Object.keys(parameters.properties ?? {})).toEqual(['html', 'title', 'width', 'sandbox'])
    expect(parameters.properties?.html).toMatchObject({ type: 'string' })
    expect(parameters.required).toEqual(['html'])
    expect(parameters.properties?.width?.type).toBe('integer')
  })

  it('apply registers the render_html tool on a composing ctx.tools', () => {
    const registered: unknown[] = []
    const ctx = {
      tools: { register: (def: unknown) => { registered.push(def); return () => {} } },
    } as unknown as Context
    tool.apply(ctx)
    expect(registered).toHaveLength(1)
    expect((registered[0] as ToolDefinition).name).toBe('render_html')
  })

  it('execute returns the pass-through view, omitting undefined width/sandbox', async () => {
    const value = await execute({ html: '<h1>hi</h1>' }, {})
    expect(value).toEqual({ html: '<h1>hi</h1>' })
  })

  it('execute carries width and sandbox through when provided', async () => {
    const value = await execute({ html: '<p>x</p>', width: 640, sandbox: 'none' }, {})
    expect(value).toEqual({ html: '<p>x</p>', width: 640, sandbox: 'none' })
  })

  it('presentResult returns the html-preview card with the view html', () => {
    expect(definition.presentResult?.({ html: '<b>x</b>' }, result({ html: '<b>x</b>' })))
      .toEqual({ card: 'html-preview', html: '<b>x</b>' })
  })

  it('presentResult passes width and sandbox through the card when present', () => {
    expect(definition.presentResult?.({ html: '<b>x</b>' }, result({
      html: '<b>x</b>', width: 480, sandbox: 'none',
    }))).toEqual({ card: 'html-preview', html: '<b>x</b>', width: 480, sandbox: 'none' })
  })

  it('presentResult falls back to a generic card when the view meta is missing or invalid', () => {
    const withoutMeta = { ...result({ html: '<b>x</b>' }) }
    delete withoutMeta.meta
    expect(definition.presentResult?.({ html: '<b>x</b>' }, withoutMeta))
      .toEqual({ card: 'generic', content: [{ type: 'text', text: 'Rendered 0 bytes of HTML to the preview card.' }] })
    expect(definition.presentResult?.({ html: '<b>x</b>' }, result({ html: 42 })))
      .toEqual({ card: 'generic', content: [{ type: 'text', text: 'Rendered 0 bytes of HTML to the preview card.' }] })
  })

  it('presentationMeta projects the view onto result.meta for replay', () => {
    expect(definition.output.presentationMeta?.({ html: '<b>x</b>', width: 600 }, { html: '<b>x</b>', width: 600 }))
      .toEqual({ html: '<b>x</b>', width: 600 })
  })

  it('output.render reports the rendered byte count', () => {
    const blocks = definition.output.render({ html: 'abcd' }, { html: 'abcd' })
    expect(blocks).toEqual([{ type: 'text', text: 'Rendered 4 bytes of HTML to the preview card.' }])
  })
})
