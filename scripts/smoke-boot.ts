#!/usr/bin/env tsx
// Boot smoke gate — actually starts `dsh web` and proves it stays up.
//
// Nothing in `typecheck` or `hygiene` ever spawns the process. Every check in
// that pipeline validates static shape (types, package.json exports, doc
// coverage) without ever asking whether the composition activates at
// runtime. That gap is exactly how a client-bundle export-condition
// regression (commit fb78e2fc9e — see docs/improvement-plan.md) reached
// `master` and broke `dsh web` for every user: 39 packages' `./client`
// export moved to a condition the runtime resolver did not understand yet,
// every check stayed green, and the first sign of trouble was the process
// crashing after the browser opened.
//
// This script closes that gap the cheap way: spawn the real CLI entry point,
// wait for the documented readiness line (not an HTTP poll — the server
// binds its socket and serves 200 well before the plugin tree finishes
// activating; see packages/bundle/web-app/src/index.ts), then confirm the
// process is still alive and answering after the plugin tree has settled.
import type { ChildProcessByStdio } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Readable } from 'node:stream'

/** `spawn(..., { stdio: ['ignore', 'pipe', 'pipe'] })`'s exact return shape. */
type SmokeBootChild = ChildProcessByStdio<null, Readable, Readable>

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const READY_LINE = /dsh web: (http:\/\/\S+)/
const READY_TIMEOUT_MS = 90_000
// The plugin tree keeps activating rows after the socket is bound and the
// readiness line prints — this is exactly the window in which the real crash
// happened. Stay up and keep answering through it before declaring success.
const SETTLE_MS = 5_000

function waitForReadyLine(child: SmokeBootChild): Promise<string> {
  return new Promise((resolveReady, reject) => {
    let out = ''
    const timer = setTimeout(() => {
      reject(new Error(`dsh web did not print a ready line within ${READY_TIMEOUT_MS}ms; output so far:\n${out}`))
    }, READY_TIMEOUT_MS)
    const onData = (chunk: Buffer): void => {
      out += chunk.toString()
      const match = READY_LINE.exec(out)
      if (match?.[1] !== undefined) {
        clearTimeout(timer)
        resolveReady(match[1])
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`dsh web exited before printing a ready line (code ${String(code)}, signal ${String(signal)}); output:\n${out}`))
    })
  })
}

async function killAndWait(child: SmokeBootChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const gone = new Promise<void>(resolveExit => child.once('exit', () => { resolveExit() }))
  child.kill('SIGTERM')
  await Promise.race([gone, new Promise(resolveTimeout => setTimeout(resolveTimeout, 10_000).unref())])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function main(): Promise<void> {
  const sessionsDir = mkdtempSync(join(tmpdir(), 'dsh-smoke-boot-'))
  const tsxLoader = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx')).href
  const child = spawn(
    process.execPath,
    ['--import', tsxLoader, join(REPO_ROOT, 'apps/cli/src/bin.ts'), 'web', '--port', '0'],
    {
      cwd: sessionsDir,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? 'smoke-boot-no-real-call',
        DSH_HOME: join(sessionsDir, '.dsh'),
        DSH_AGENTS_HOME: join(sessionsDir, '.agents'),
        TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  try {
    const readyUrl = await waitForReadyLine(child)
    const firstResponse = await fetch(readyUrl)
    if (!firstResponse.ok) {
      throw new Error(`dsh web answered the ready URL with HTTP ${firstResponse.status}`)
    }
    // The exact failure this gate exists for: the tree keeps activating rows
    // after the ready line prints, and a broken client-plugin row disposes
    // the whole fiber tree — including the socket just proven live above —
    // moments later. Wait out that window before trusting the first response.
    await new Promise(resolveWait => setTimeout(resolveWait, SETTLE_MS))
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`dsh web exited during the post-ready settle window (code ${String(child.exitCode)}, signal ${String(child.signalCode)})`)
    }
    const settledResponse = await fetch(readyUrl)
    if (!settledResponse.ok) {
      throw new Error(`dsh web stopped answering after the settle window: HTTP ${settledResponse.status}`)
    }
    console.log(`smoke-boot: dsh web stayed up and answered ${readyUrl} through the settle window`)
  } finally {
    await killAndWait(child)
    rmSync(sessionsDir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(`smoke-boot: FAILED — ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
