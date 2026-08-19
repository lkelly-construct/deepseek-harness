/** Package-owned durable invariants for the preset router. @module @deepseek-ai/dsh-preset-router/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-preset-router'

/** Cordis companion plugin name. */
export const name = 'preset-router-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant.
 *
 * Routing is best-effort and composes nothing itself. The model-visible
 * auxiliary request is logged (and audited) as the injected
 * `preset-route/llm-request` session event, and the applied selection as the
 * caller's `agent-preset/selected` event. This installer only reserves package
 * ownership in the invariant registry.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {
  // No runtime invariant: routing writes no durable state of its own.
}, { inject: [] })

/**
 * Register the preset-router invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
