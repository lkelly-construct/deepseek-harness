/** Package-owned durable invariants for the image-aware model router. @module @deepseek-ai/dsh-image-router/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-image-router'

/** Cordis companion plugin name. */
export const name = 'image-router-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant.
 *
 * The router writes no durable session event of its own; its routing manifests
 * in the agent loop's `request/header`/`request/context` events, which the loop
 * already covers. This installer only reserves package ownership.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {
  // No runtime invariant: routing surfaces through the loop's request/header events.
}, { inject: [] })

/**
 * Register the image-router invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
