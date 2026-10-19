/**
 * Logo QA harness for the RaveWall brand assets.
 *
 *   node scripts/qa-logo.mjs
 *
 * Renders screenshots/logo-sheet.html (the icon at 16/24/32/48/128px, the
 * horizontal lockup, and both monochrome variants) in the local Chromium over
 * CDP and writes a 2x screenshot so star and bubble geometry can be inspected
 * at favicon scale. No server required.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const OUT_DIR = process.env.OUT_DIR ?? path.join(process.cwd(), 'screenshots')
const PORT = Number(process.env.CDP_PORT ?? 9223)

const CANDIDATES = [
  process.env.CHROME_PATH,
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
].filter(Boolean)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function resolveChrome() {
  for (const candidate of CANDIDATES) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      /* keep looking */
    }
  }
  throw new Error('No Chromium binary found. Set CHROME_PATH.')
}

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    this.socket.onmessage = (event) => this.#handle(JSON.parse(event.data))
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.onopen = resolve
      socket.onerror = () => reject(new Error(`Could not open CDP socket at ${url}`))
    })
    return new Cdp(socket)
  }

  #handle(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) reject(new Error(message.error))
      else resolve(message.result)
    }
  }

  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`))
      }, 20_000)
    })
  }

  close() {
    this.socket.close()
  }
}

async function waitForDevTools() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('DevTools endpoint never became reachable')
}

async function main() {
  const chrome = await resolveChrome()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ravewall-logo-'))
  const sheet = path.join(process.cwd(), 'screenshots', 'logo-sheet.html')

  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  )

  let cdp
  try {
    cdp = await Cdp.connect(await waitForDevTools())
    await cdp.send('Page.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 780,
      height: 600,
      deviceScaleFactor: 2,
      mobile: false,
    })
    await cdp.send('Page.navigate', { url: `file://${sheet.replaceAll('\\', '/')}` })
    await sleep(1200)
    const result = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    })
    const file = path.join(OUT_DIR, 'logo-sheet.png')
    await fs.writeFile(file, Buffer.from(result.data, 'base64'))
    console.log(`captured ${path.relative(process.cwd(), file)}`)
  } finally {
    cdp?.close()
    child.kill()
  }
}

main().catch((error) => {
  console.error(`logo QA failed: ${error.message}`)
  process.exitCode = 1
})
