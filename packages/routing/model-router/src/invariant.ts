/** Package-owned durable invariants for the dynamic model router. @module @deepseek-ai/dsh-model-router/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-model-router'

/** Cordis companion plugin name. */
export const name = 'model-router-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant.
 *
 * `set_model_hint` writes no durable session event — hints are ephemeral
 * in-process state keyed by session id and are not persisted to the session log.
 * This installer only reserves package ownership in the invariant registry.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {
  // No runtime invariant: routing hints are ephemeral in-process state.
}, { inject: [] })

/**
 * Register the model-router invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
