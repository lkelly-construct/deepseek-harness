// Web e2e scenario: the `app-preview` card. Cold-seeds one settled turn whose
// `render_app_url` tool/result carries the projected view in its `meta`, so the
// host (through the real registered `@deepseek-ai/dsh-tool-app-preview`
// presentResult) computes the `app-preview` render intent and the browser draws
// the sandboxed live-app iframe. Zero model calls: no replay fixture mounts, so
// a stray stream fails loud.
import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  launchWebScaffold, seedSession, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SHIPPED_PRESETS = fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url))
const SEED_ID = 'app-preview-web-e2e'
/** A localhost URL the fixture renders; nothing listens on this port in CI, so
 *  the iframe just shows the browser's error page — the test asserts attributes,
 *  not live content. */
const FIXTURE_URL = 'http://localhost:9876/app'

/** A live `render_app_url` payload the tool canonically returns. */
function renderAppUrlView(url: string): { url: string; width: number; sandbox: string } {
  return { url, width: 480, sandbox: 'allow-scripts allow-same-origin' }
}

/**
 * One settled turn whose single `render_app_url` call completed with the projected
 * view in `meta` — exactly what the real tool's `output.presentationMeta` persists.
 * @returns a tokenized session log ending on a closed turn.
 */
function appPreviewFixture(): string {
  const session = Session.create(SessionId('app-preview-source'))
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Show me the running app.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'App preview', messageSeqs: [user.seq], source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  const callId = CallId('app-preview-call-1')
  const args = JSON.stringify(renderAppUrlView(FIXTURE_URL))
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'tool-call' as const, id: callId, name: 'render_app_url', arguments: args }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  const call = session.append('tool/call', {
    turn: 1, step: 1, callId, name: 'render_app_url', arguments: args,
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: `Rendered ${FIXTURE_URL} to the app-preview card.` }],
      isError: false,
    }),
    meta: renderAppUrlView(FIXTURE_URL),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      // No body event references the cwd, so a fixed posix token keeps the
      // header JSON valid on Windows (a `{{cwd}}` substitution would inject
      // backslashes); seedSession overrides the persisted header cwd anyway.
      createdAt: 0, cwd: '/seed-workspace',
    }),
    ...session.events.map(event => JSON.stringify({
      ...event, time: 0 + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

/**
 * The demo preset: a fixed persona plus the `render_app_url` pass-through tool.
 * No shell/fs rows are needed — the tool only registers into the host tools
 * registry, so the composition is the smallest that still mounts a model-facing
 * tool. It lives in a temp user root so the test never touches a real DSH_HOME.
 * @param userRoot - the temp user preset root to write into.
 */
async function writeDemoPreset(userRoot: string): Promise<void> {
  const dir = join(userRoot, 'app-preview-demo')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), [
    '# Demo app-preview preset: fixed persona + the render_app_url pass-through.',
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    text: You are a helpful assistant.',
    '',
    '- id: tool-app-preview',
    "  name: '@deepseek-ai/dsh-tool-app-preview'",
    '',
  ].join('\n'))
}

describe('web e2e: a render_app_url call draws the sandboxed app-preview card', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const userRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-web-e2e-app-preview-')))
    await writeDemoPreset(userRoot)
    scaffold = await launchWebScaffold({
      agentPresets: {
        roots: [
          { path: SHIPPED_PRESETS, trust: 'system' },
          { path: userRoot, trust: 'user' },
        ],
        default: 'standard',
      },
    })
    await seedSession(scaffold, appPreviewFixture(), SEED_ID, 'app-preview-demo')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.setViewportSize({ width: 1280, height: 900 })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders the sandboxed live-app iframe with the projected URL and safe defaults', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-app-preview'))
    const tree = page.locator('[role="treeitem"]').first()
    await tree.waitFor({ timeout: 15_000 })
    if (await tree.getAttribute('aria-expanded') !== 'true') await tree.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    // The seeded transcript loads after selection; wait for its user message.
    await expect.poll(() => page.getByText('Show me the running app.', { exact: true }).count(), { timeout: 20_000 }).toBe(1)

    // The card body: the copy toolbar plus the sandboxed iframe carrying src.
    // The row starts collapsed (keepContentWhenOpen mounts the card hidden), so
    // expand it first, then assert the visible card.
    const toolRow = page.locator('[data-tool="render_app_url"]').first()
    await toolRow.waitFor({ timeout: 20_000 })
    await toolRow.click()
    const card = page.locator('[data-app-preview]').first()
    try {
      await card.waitFor({ timeout: 20_000 })
    } catch {
      console.log('=== DUMP: treeitems ===', await page.locator('[role="treeitem"]').allTextContents())
      console.log('=== DUMP: conversation text ===', (await page.locator('body').innerText()).slice(0, 1500))
      console.log('=== DUMP: tool rows ===', await page.locator('[data-tool]').allTextContents())
      throw new Error('app-preview card never appeared')
    }
    const iframe = card.locator('iframe[title="App preview"]')
    await iframe.waitFor({ timeout: 10_000 })
    expect(await iframe.getAttribute('src')).toBe(FIXTURE_URL)
    expect(await iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(await iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
    // The declared viewport width rides onto the iframe.
    expect(await iframe.getAttribute('style')).toContain('480px')
    // The toolbar surfaces the URL and a copy control.
    expect(await card.getByText(FIXTURE_URL, { exact: true }).count()).toBe(1)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 45_000)
})
