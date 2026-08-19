/** Package-owned durable invariants for the artifact publish tool. @module @deepseek-ai/dsh-tool-artifact-publish/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-artifact-publish'

/** Cordis companion plugin name. */
export const name = 'tool-artifact-publish-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant.
 *
 * `publish_artifact` uploads files and returns presigned URLs but writes no
 * durable session event of its own. This installer only reserves package
 * ownership in the invariant registry.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {
  // No runtime invariant: artifact uploads are transient side effects.
}, { inject: [] })

/**
 * Register the tool-artifact-publish invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
