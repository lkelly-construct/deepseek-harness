import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as AppPreviewInvariant from '../src/invariant.ts'

/**
 * The companion owns no durable data (see the `No runtime invariant` reason in
 * src/invariant.ts), so the registry's only obligation is accepting the
 * package-name reservation without failing on unrelated session events.
 */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(AppPreviewInvariant)
  return ctx
}

describe('dsh-tool-app-preview invariant companion', () => {
  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    expect('default' in AppPreviewInvariant).toBe(false)
    expect(AppPreviewInvariant.name).toBe('tool-app-preview-invariant')
    expect(AppPreviewInvariant.inject).toEqual(['invariants'])
    expect(typeof AppPreviewInvariant.apply).toBe('function')
  })

  it('registers the package name with the invariant registry', async () => {
    // apply() reserves the package name; a second registration of the same
    // package must then be rejected as already-registered.
    const ctx = await setup()
    await expect(ctx.plugin(AppPreviewInvariant)).rejects.toThrow('already registered')
  })

  it('ignores unrelated dispatches and session events (no owned durable data)', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('tools/change')
      ctx.emit('session/event', {} as never, {
        type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
      })
    }).not.toThrow()
  })
})
