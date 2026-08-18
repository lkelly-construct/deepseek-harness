/** Package-owned durable invariants for local persistent memory. @module @deepseek-ai/dsh-memory-local/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-local'

/** Cordis companion plugin name. */
export const name = 'memory-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant.
 *
 * Memory writes are durable files under `~/.dsh/memory/` that the system prompt
 * section reads back; they are not session events, so there is no package-owned
 * durable event/data relationship for the invariant registry to cross-check.
 * This installer only reserves `@deepseek-ai/dsh-memory-local` ownership and
 * reports nothing.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {
  // No runtime invariant: memory files live outside the session event stream, so
  // there is no package-owned durable relationship for the registry to cross-check.
}, { inject: [] })

/**
 * Register the memory-local invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
