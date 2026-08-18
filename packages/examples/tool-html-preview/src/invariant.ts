/** Package-owned durable invariants for the HTML preview demo tool. @module @deepseek-ai/dsh-tool-html-preview/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-html-preview'

/** Cordis companion plugin name. */
export const name = 'tool-html-preview-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant.
 *
 * `render_html` is a pass-through view producer: it writes no durable event and
 * its canonical view value is never persisted as a session event. There is no
 * package-owned durable relationship for the invariant registry to cross-check,
 * so this installer only reserves `@deepseek-ai/dsh-tool-html-preview` ownership
 * (the environment registry validates that the manifest is claimed) and reports
 * nothing.
 */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {
  // No runtime invariant: render_html is a pass-through view producer that writes
  // no durable event and persists nothing of its own, so there is no package-owned
  // durable relationship for the registry to cross-check.
}, { inject: [] })

/**
 * Register the tool-html-preview invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
