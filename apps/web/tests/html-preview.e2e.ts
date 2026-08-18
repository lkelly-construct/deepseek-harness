// Web e2e scenario: the `html-preview` card. Cold-seeds one settled turn whose
// `render_html` tool/result carries the projected view in its `meta`, so the host
// (through the real registered `@deepseek-ai/dsh-tool-html-preview` presentResult)
// computes the `html-preview` render intent and the browser draws the sandboxed
// iframe. Zero model calls: no replay fixture mounts, so a stray stream fails loud.
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
const SEED_ID = 'html-preview-web-e2e'
/** HTML the fixture renders; stable, short, and distinct in the srcdoc. */
const FIXTURE_HTML = '<h1 id="theme-sample">DeepSeek Harness preview</h1>'

/** A live `render_html` payload the tool canonically returns. */
function renderHtmlView(html: string): { html: string; width: number; sandbox: string } {
  return { html, width: 480, sandbox: 'allow-scripts' }
}

/**
 * One settled turn whose single `render_html` call completed with the projected
 * view in `meta` — exactly what the real tool's `output.presentationMeta` persists.
 * @returns a tokenized session log ending on a closed turn.
 */
function htmlPreviewFixture(): string {
  const session = Session.create(SessionId('html-preview-source'))
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Show me a preview.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'HTML preview', messageSeqs: [user.seq], source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  const callId = CallId('html-preview-call-1')
  const args = JSON.stringify(renderHtmlView(FIXTURE_HTML))
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'tool-call' as const, id: callId, name: 'render_html', arguments: args }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  const call = session.append('tool/call', {
    turn: 1, step: 1, callId, name: 'render_html', arguments: args,
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId,
      content: [{ type: 'text', text: 'Rendered 34 bytes of HTML to the preview card.' }],
      isError: false,
    }),
    meta: renderHtmlView(FIXTURE_HTML),
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
 * The demo preset: a fixed persona plus the `render_html` pass-through tool.
 * No shell/fs rows are needed — the tool only registers into the host tools
 * registry, so the composition is the smallest that still mounts a model-facing
 * tool. It lives in a temp user root so the test never touches a real DSH_HOME.
 * @param userRoot - the temp user preset root to write into.
 */
async function writeDemoPreset(userRoot: string): Promise<void> {
  const dir = join(userRoot, 'html-preview-demo')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), [
    '# Demo html-preview preset: fixed persona + the render_html pass-through.',
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    text: You are a helpful assistant.',
    '',
    '- id: tool-html-preview',
    "  name: '@deepseek-ai/dsh-tool-html-preview'",
    '',
  ].join('\n'))
}

describe('web e2e: a render_html call draws the sandboxed html-preview card', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const userRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-web-e2e-html-preview-')))
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
    await seedSession(scaffold, htmlPreviewFixture(), SEED_ID, 'html-preview-demo')
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

  it('renders the sandboxed iframe with the projected HTML and safe defaults', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-html-preview'))
    const tree = page.locator('[role="treeitem"]').first()
    await tree.waitFor({ timeout: 15_000 })
    if (await tree.getAttribute('aria-expanded') !== 'true') await tree.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    // The seeded transcript loads after selection; wait for its user message.
    await expect.poll(() => page.getByText('Show me a preview.', { exact: true }).count(), { timeout: 20_000 }).toBe(1)

    // The card body: the copy toolbar plus the sandboxed iframe carrying srcdoc.
    // The row starts collapsed (keepContentWhenOpen mounts the card hidden), so
    // expand it first, then assert the visible card.
    const toolRow = page.locator('[data-tool="render_html"]').first()
    await toolRow.waitFor({ timeout: 20_000 })
    await toolRow.click()
    const card = page.locator('[data-html-preview]').first()
    try {
      await card.waitFor({ timeout: 20_000 })
    } catch {
      console.log('=== DUMP: treeitems ===', await page.locator('[role="treeitem"]').allTextContents())
      console.log('=== DUMP: conversation text ===', (await page.locator('body').innerText()).slice(0, 1500))
      console.log('=== DUMP: tool rows ===', await page.locator('[data-tool]').allTextContents())
      throw new Error('html-preview card never appeared')
    }
    const iframe = card.locator('iframe[title="HTML preview"]')
    await iframe.waitFor({ timeout: 10_000 })
    expect(await iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(await iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(await iframe.getAttribute('srcdoc')).toContain(FIXTURE_HTML)
    // The declared viewport width rides onto the iframe.
    expect(await iframe.getAttribute('style')).toContain('480px')

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 45_000)
})
