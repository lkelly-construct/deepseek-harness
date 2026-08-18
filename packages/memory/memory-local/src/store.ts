/**
 * Per-workspace persistent-memory file store.
 *
 * Swift scope: files live under `~/.dsh/memory/<sha256-hash-of-workspace>/`,
 * one `.md` per memory bearing a `name`/`type` front-matter header. The store
 * is scoped by workspace so sessions in different workspaces never see each
 * other's memories.
 * @module @deepseek-ai/dsh-memory-local/store
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The per-workspace memory directory under the harness home.
 * @param workspacePath - the workspace whose memory directory is wanted.
 * @returns the absolute directory holding that workspace's memory files.
 */
export function memoryDir(workspacePath: string): string {
  const hash = createHash('sha256').update(workspacePath).digest('hex').slice(0, 16)
  return join(homedir(), '.dsh', 'memory', hash)
}

/**
 * Read every memory file for one workspace; a missing directory yields [].
 * Synchronous by design: the only caller is the synchronous system-prompt
 * section callback, and an async read there would race the first assembly.
 * The payload is a few small markdown files, read once per workspace.
 * @param workspacePath - the workspace whose memories to read.
 * @returns the full text of each `.md` file, in readdir order.
 */
export function readMemories(workspacePath: string): string[] {
  try {
    const dir = memoryDir(workspacePath)
    return readdirSync(dir)
      .filter(name => name.endsWith('.md'))
      .map(name => readFileSync(join(dir, name), 'utf8'))
  } catch {
    return []
  }
}

/**
 * Write one memory file, creating the workspace directory on demand.
 * @param workspacePath - the workspace to scope the memory to.
 * @param slug - the memory's filesystem filename base.
 * @param type - the memory's classification, stored in front-matter.
 * @param content - the memory's markdown body.
 * @returns a promise resolving once the file is durably written.
 */
export async function writeMemory(
  workspacePath: string, slug: string, type: string, content: string,
): Promise<void> {
  const dir = memoryDir(workspacePath)
  await mkdir(dir, { recursive: true })
  const front = `---\nname: ${slug}\ntype: ${type}\n---\n\n`
  await writeFile(join(dir, `${slug}.md`), `${front}${content}\n`, 'utf8')
}

/**
 * Delete one memory file; returns false when it was already absent.
 * @param workspacePath - the workspace the memory is scoped to.
 * @param slug - the memory's filesystem filename base.
 * @returns true when the file was removed, false when it did not exist.
 */
export async function deleteMemory(workspacePath: string, slug: string): Promise<boolean> {
  try {
    await unlink(join(memoryDir(workspacePath), `${slug}.md`))
    return true
  } catch {
    return false
  }
}
