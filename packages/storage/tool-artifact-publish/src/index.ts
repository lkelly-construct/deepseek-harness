/**
 * Artifact publisher tool — uploads a local file to Supabase Storage and
 * returns a 24-hour presigned URL. The agent calls `publish_artifact` with
 * an absolute or cwd-relative file path; the plugin handles the upload and
 * presigning transparently.
 *
 * Required env vars (never committed):
 *   Corax_AI_Supabase_URL         — Supabase project URL
 *   Corax_AI_Supabase_Service_Key — service-role key (server-side only)
 *
 * @module @deepseek-ai/dsh-tool-artifact-publish
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-artifact-publish'
export const inject = ['tools']

/** Apply the plugin — skips registration silently when env vars are absent. */
export function apply(ctx: Context): void {
  const supabaseUrl = process.env['Corax_AI_Supabase_URL']
  const serviceKey = process.env['Corax_AI_Supabase_Service_Key']

  if (supabaseUrl === undefined || supabaseUrl === '' || serviceKey === undefined || serviceKey === '') {
    ctx.logger('tool-artifact-publish').warn(
      'Corax_AI_Supabase_URL or Corax_AI_Supabase_Service_Key is not set — publish_artifact tool not registered',
    )
    return
  }

  ctx.tools.register(defineTool({
    name: 'publish_artifact',
    description:
      'Upload a local file to shared artifact storage and return a 24-hour presigned download URL. '
      + 'Use this to share files (reports, images, data exports, etc.) with the user or external services. '
      + 'Pass an absolute path or a path relative to the current working directory.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute or cwd-relative path to the local file to publish.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: (value as { url: string }).url }],
    },
    async execute(args: { path: string }, exec) {
      const absolutePath = resolvePath(exec.agent?.session.header.cwd ?? process.cwd(), args.path)
      const fileBytes = await readFile(absolutePath)

      const sessionId: string = (ctx as Context & { session?: { id?: string } }).session?.id ?? 'default'
      const uuid = randomUUID()
      const ext = extname(absolutePath)
      const objectPath = `${sessionId}/${uuid}${ext}`

      // Upload the file.
      const uploadUrl = `${supabaseUrl}/storage/v1/object/dsh-artifacts/${objectPath}`
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: fileBytes,
      })
      if (!uploadResponse.ok) {
        const body = await uploadResponse.text()
        throw new Error(`Supabase upload failed (${uploadResponse.status}): ${body}`)
      }

      // Get a 24-hour presigned URL.
      const signUrl = `${supabaseUrl}/storage/v1/object/sign/dsh-artifacts/${objectPath}`
      const signResponse = await fetch(signUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 86400 }),
      })
      if (!signResponse.ok) {
        const body = await signResponse.text()
        throw new Error(`Supabase sign failed (${signResponse.status}): ${body}`)
      }

      const { signedURL } = (await signResponse.json()) as { signedURL: string }
      return { url: `${supabaseUrl}/storage/v1${signedURL}` }
    },
    presentCall: (args: { path: string }) => ({
      card: 'generic' as const,
      title: 'publish_artifact',
      kind: 'execute' as const,
      rawInput: args.path,
      content: [{ type: 'text' as const, text: `Publishing ${args.path}` }],
    }),
  }))
}
