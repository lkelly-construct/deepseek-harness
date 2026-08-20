/**
 * Deliverables plugin, node half. Registers the response-format guidance that
 * lets the browser half recognize final-response file references. The browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Services required for the model guidance paired with the browser renderer. */
export const inject = ['systemPrompt']

/**
 * Stable final-response guidance owned by the matching renderer. Formatting
 * only -- it must not require mentioning file outputs, which would
 * contradict the harness-owned conciseness policy ("skip summarizing what
 * you just did unless asked").
 */
const FILE_REFERENCE_PROMPT = 'When your final response mentions a file you created or modified, '
  + 'format it as Markdown inline code using the exact file-tool path, or a basename when unique among the files changed in that turn, so Web renders it clickable.'

/**
 * Register model guidance for the file-reference renderer shipped by this package.
 * @param ctx - host context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'ui:deliverable-file-references',
    order: 190,
    text: FILE_REFERENCE_PROMPT,
  })
}
