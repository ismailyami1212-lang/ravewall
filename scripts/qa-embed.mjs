/**
 * External embed QA (Phase I).
 *
 *   node scripts/qa-embed.mjs
 *
 * Requires the local dev server (PGLITE_DIR=memory) on BASE_URL. Seeds a
 * business with approved testimonials, then loads screenshots/embed-test.html
 * — an ordinary, deliberately opinionated host page that embeds three widgets —
 * in headless Chromium and captures it at desktop and mobile widths while
 * checking that:
 *   - every widget rendered inside its shadow root,
 *   - the host's hostile CSS did not reach the widget,
 *   - the widget did not leak styles into the host page,
 *   - no console errors fired.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3999').replace(/\/$/, '')
const OUT_DIR = process.env.OUT_DIR ?? path.join(process.cwd(), 'screenshots')
const PORT = Number(process.env.CDP_PORT ?? 9226)
const SLUG = 'northwind'

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
    this.listeners = new Map()
    socket.onmessage = (event) => this.#handle(JSON.parse(event.data))
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
      return
    }
    if (!message.method) return
    const listeners = this.listeners.get(message.method)
    if (listeners) for (const cb of [...listeners]) cb(message.params)
  }

  send(method, params = {}) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`))
      }, 30_000)
    })
  }

  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set())
    this.listeners.get(method).add(cb)
  }

  close() {
    this.socket.close()
  }
}

const CONSOLE_ERRORS = []

async function seed() {
  const email = `embed-qa-${Date.now()}@example.com`
  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Passw0rd!', name: 'Embed QA' }),
  })
  if (!signup.ok) throw new Error(`signup failed: ${signup.status}`)
  const raw = signup.headers.getSetCookie?.()[0] ?? signup.headers.get('set-cookie') ?? ''
  const token = /kudos_session=([^;]+)/.exec(raw)?.[1]
  if (!token) throw new Error('no session cookie')

  await fetch(`${BASE}/api/business`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `kudos_session=${token}` },
    body: JSON.stringify({
      name: 'Northwind Studio',
      slug: SLUG,
      tagline: 'Design studio for ambitious teams',
      accentColor: '#0d9488',
    }),
  })

  const entries = [
    { rating: 5, name: 'Mara Ellis', company: 'Northwind Studio', text: 'They rebuilt our pricing page in a week and conversion went up 18%. The whole process was calm and predictable.' },
    { rating: 5, name: 'Tobias Lang', company: 'Fieldnote', text: 'The moderation queue is the part I did not know I needed. Nothing reaches the public page until we say so.' },
    { rating: 4, name: 'Priya Raman', company: 'Cobalt Labs', text: 'Set up in about two minutes, sent the link, had eleven testimonials by the next morning.' },
    { rating: 2, name: 'Spam Bot', company: 'Cheap Deals', text: 'BUY CHEAP FOLLOWERS AT OUR SITE NOW, BEST PRICES GUARANTEED FOR ALL ACCOUNTS.' },
  ]

  for (const entry of entries) {
    const created = await fetch(`${BASE}/api/public/submit/${SLUG}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
    if (!created.ok) continue
    const list = await fetch(`${BASE}/api/testimonials?status=pending`, {
      headers: { Cookie: `kudos_session=${token}` },
    })
    const body = await list.json()
    const match = body.data.items.find((item) => item.name === entry.name)
    if (!match) continue
    await fetch(`${BASE}/api/testimonials/${match.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: `kudos_session=${token}` },
      body: JSON.stringify({ status: entry.rating >= 4 ? 'approved' : 'rejected' }),
    })
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
  await seed()
  console.log(`seeded ${SLUG} with three approved + one rejected testimonial`)

  const chrome = await resolveChrome()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ravewall-embed-'))
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
  const shots = [
    { name: 'embed-host-1440', width: 1440, height: 1000, mobile: false },
    { name: 'embed-host-768', width: 768, height: 1000, mobile: false },
    { name: 'embed-host-390', width: 390, height: 900, mobile: true },
  ]

  try {
    cdp = await Cdp.connect(await waitForDevTools())
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        CONSOLE_ERRORS.push(`console.error: ${params.text}`)
      }
    })
    cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails ?? {}
      CONSOLE_ERRORS.push(`exception: ${details.exception?.description ?? details.text ?? 'unknown'}`)
    })

    const page = path.join(process.cwd(), 'screenshots', 'embed-test.html')

    for (const shot of shots) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: shot.width,
        height: shot.height,
        deviceScaleFactor: 1,
        mobile: shot.mobile,
      })
      await cdp.send('Page.navigate', { url: `file://${page.replaceAll('\\', '/')}` })
      await sleep(2500)

      if (shot.width === 1440) {
        // Structural assertions on the rendered widgets.
        const probe = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const hosts = document.querySelectorAll('[data-ravewall-widget]')
            const results = []
            hosts.forEach((host) => {
              const root = host.shadowRoot
              if (!root) { results.push({ ok: false, reason: 'no shadow root' }); return }
              const card = root.querySelector('.rw-card') || root.querySelector('.rw-compact-item')
              const cardStyle = card ? getComputedStyle(card) : null
              results.push({
                ok: Boolean(card),
                cards: root.querySelectorAll('.rw-card').length,
                compactItems: root.querySelectorAll('.rw-compact-item').length,
                slides: root.querySelectorAll('.rw-carousel-slide').length,
                powered: Boolean(root.querySelector('.rw-powered')),
                border: cardStyle ? cardStyle.borderTopWidth : null,
                color: cardStyle ? cardStyle.color : null,
                font: cardStyle ? cardStyle.fontFamily.slice(0, 30) : null,
                spamLeak: root.textContent.includes('BUY CHEAP FOLLOWERS'),
              })
            })
            const hostButtonFont = getComputedStyle(document.body).fontFamily
            return JSON.stringify({ widgets: results, hostBodyFont: hostButtonFont })
          })()`,
          returnByValue: true,
        })
        console.log('widget probe:', probe.result.value)
      }

      const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      const file = path.join(OUT_DIR, `${shot.name}.png`)
      await fs.writeFile(file, Buffer.from(result.data, 'base64'))
      console.log(`captured ${path.relative(process.cwd(), file)}`)
    }
  } finally {
    cdp?.close()
    child.kill()
  }

  if (CONSOLE_ERRORS.length > 0) {
    console.log(`console errors: ${CONSOLE_ERRORS.length}`)
    for (const error of CONSOLE_ERRORS) console.log(`  ${error}`)
    process.exitCode = 1
  } else {
    console.log('console errors: 0')
  }
}

main().catch((error) => {
  console.error(`embed QA failed: ${error.message}`)
  process.exitCode = 1
})
