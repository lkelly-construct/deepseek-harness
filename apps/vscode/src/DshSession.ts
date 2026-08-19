import { spawn, ChildProcess } from 'node:child_process'
import * as vscode from 'vscode'

const READY_RE = /^dsh web: http:\/\/127\.0\.0\.1:(\d+)/m
const STARTUP_TIMEOUT_MS = 30_000

/**
 * Manages one `dsh web` subprocess per VS Code workspace folder. Parses the
 * readiness signal ("dsh web: http://127.0.0.1:<PORT>") from stdout — the same
 * sentinel supervisors use to detect a live server.
 */
export class DshSession {
  private proc: ChildProcess | undefined
  private _port: number | undefined
  private readonly outputChannel: vscode.OutputChannel

  constructor(private readonly cwd: string) {
    this.outputChannel = vscode.window.createOutputChannel('DSH Server')
  }

  get port(): number {
    if (this._port === undefined) throw new Error('DshSession: not started')
    return this._port
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async start(): Promise<void> {
    if (this.proc !== undefined) return

    this.outputChannel.appendLine(`[dsh] Starting in ${this.cwd}`)

    this.proc = spawn('dsh', ['web'], {
      cwd: this.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    this._port = await this.waitForPort()
    this.outputChannel.appendLine(`[dsh] Listening on port ${this._port}`)

    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this.outputChannel.append(chunk.toString())
    })
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      this.outputChannel.append(chunk.toString())
    })
    this.proc.on('exit', (code) => {
      this.outputChannel.appendLine(`[dsh] Process exited (code ${code ?? 'null'})`)
      this.proc = undefined
      this._port = undefined
    })
  }

  private waitForPort(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`DSH server did not become ready within ${STARTUP_TIMEOUT_MS}ms`)),
        STARTUP_TIMEOUT_MS,
      )

      let buf = ''
      const onData = (chunk: Buffer): void => {
        buf += chunk.toString()
        const m = READY_RE.exec(buf)
        if (m !== null) {
          clearTimeout(timer)
          this.proc?.stdout?.removeListener('data', onData)
          resolve(Number(m[1]))
        }
        this.outputChannel.append(chunk.toString())
      }

      this.proc?.stdout?.on('data', onData)
      this.proc?.on('error', (err) => { clearTimeout(timer); reject(err) })
      this.proc?.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`DSH exited before ready (code ${code ?? 'null'})`))
      })
    })
  }

  async restart(): Promise<void> {
    this.dispose()
    await this.start()
  }

  dispose(): void {
    this.proc?.kill()
    this.proc = undefined
    this._port = undefined
    this.outputChannel.dispose()
  }
}
