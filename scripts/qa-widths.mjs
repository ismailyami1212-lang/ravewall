/**
 * Multi-width visual QA harness for the RaveWall redesign.
 *
 * Builds on scripts/screenshot.mjs: launches the local Chromium, drives it over
 * CDP, and captures every key route at four widths (1440 / 1280 / 768 / 390).
 * It also collects console errors and page exceptions so we can assert a clean
 * console. The demo business is created with a deliberately non-default accent
 * (teal) to prove per-business branding still overrides the RaveWall green.
 *
 * Requires the local dev server (PGLITE_DIR=memory) running on BASE_URL.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3999').replace(/\/$/, '')
const OUT_DIR = process.env.OUT_DIR ?? path.join(process.cwd(), 'screenshots')
const PORT = Number(process.env.CDP_PORT ?? 9222)
const WIDTHS = [1440, 1280, 1024, 768, 390, 360]

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
    this.waiters = []
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
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
      return
    }
    if (!message.method) return
    this.waiters = this.waiters.filter((waiter) => {
      if (waiter.method !== message.method) return true
      waiter.resolve(message.params)
      return false
    })
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
      }, 20_000)
    })
  }

  waitFor(method, timeout = 15_000) {
    return new Promise((resolve, reject) => {
      const waiter = { method, resolve }
      this.waiters.push(waiter)
      setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry !== waiter)
        reject(new Error(`Timed out waiting for ${method}`))
      }, timeout)
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
  throw new Error('Chromium did not expose a DevTools endpoint')
}

async function createSession() {
  const email = `qa-${Date.now()}@example.com`
  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Passw0rd!', name: 'QA Reviewer' }),
  })
  if (!signup.ok) throw new Error(`signup failed: ${signup.status}`)
  const raw = signup.headers.getSetCookie?.()[0] ?? signup.headers.get('set-cookie') ?? ''
  const token = /kudos_session=([^;]+)/.exec(raw)?.[1]
  if (!token) throw new Error('no session cookie returned')

  const slug = `qa-${Date.now().toString(36)}`
  await fetch(`${BASE}/api/business`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `kudos_session=${token}` },
    body: JSON.stringify({
      name: 'Northwind Studio',
      slug,
      tagline: 'Design studio for ambitious teams',
      accentColor: '#0d9488',
    }),
  })
  return { token, email, slug }
}

const DEMO = [
  { rating: 5, name: 'Mara Ellis', company: 'Northwind Studio', text: 'They rebuilt our pricing page in a week and conversion went up 18%. The whole process was calm and predictable.', status: 'approved' },
  { rating: 5, name: 'Tobias Lang', company: 'Fieldnote', text: 'The moderation queue is the part I did not know I needed. Nothing reaches the public page until we say so.', status: 'approved' },
  { rating: 4, name: 'Priya Raman', company: 'Cobalt Labs', text: 'Set up in about two minutes, sent the link, had eleven testimonials by the next morning.', status: 'approved' },
  { rating: 5, name: 'Danny Okonkwo', company: 'Lantern Health', text: 'Our sales team now pastes real quotes into proposals instead of writing them by hand. Huge time saver.', status: 'approved' },
  { rating: 4, name: 'Sofia Marchetti', company: 'Ridgeway Partners', text: 'Clean, fast and it looks like part of our own site rather than a third party widget.', status: 'approved' },
  { rating: 5, name: 'Idris Bello', company: '', text: 'Genuinely the simplest tool we have added this year. It just works and the wall looks great.', status: 'pending' },
  { rating: 3, name: 'Hannah Cole', company: 'Bright Path', text: 'Good product overall, though I would like more control over how the wall is sorted.', status: 'pending' },
  { rating: 2, name: 'Spam Bot', company: 'Cheap Deals', text: 'BUY CHEAP FOLLOWERS AT OUR SITE NOW, BEST PRICES GUARANTEED FOR ALL ACCOUNTS.', status: 'rejected' },
]

async function seedDemoContent(token, slug) {
  const auth = { Cookie: `kudos_session=${token}` }
  for (const entry of DEMO) {
    const created = await fetch(`${BASE}/api/public/submit/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: entry.rating, name: entry.name, company: entry.company, text: entry.text }),
    })
    if (!created.ok) continue
    if (entry.status === 'pending') continue
    const list = await fetch(`${BASE}/api/testimonials?status=pending`, { headers: auth })
    const body = await list.json()
    const match = body.data.items.find((item) => item.name === entry.name)
    if (!match) continue
    await fetch(`${BASE}/api/testimonials/${match.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ status: entry.status }),
    })
  }
}

const PUBLIC_ROUTES = [
  { name: 'landing', url: '/' },
  { name: 'signup', url: '/signup' },
  { name: 'login', url: '/login' },
  { name: 'forgot-password', url: '/forgot-password' },
  { name: 'reset-password', url: '/reset-password?token=invalid-token-state' },
  { name: 'privacy', url: '/privacy' },
  { name: 'terms', url: '/terms' },
  { name: 'not-found', url: '/this-route-does-not-exist' },
]
const AUTHED_ROUTES = [
  { name: 'dashboard', url: '/dashboard' },
  { name: 'widgets', url: '/widgets' },
  { name: 'settings', url: '/settings' },
  { name: 'collection', url: null }, // filled with slug
  { name: 'wall', url: null }, // filled with slug
]

async function main() {
  const chrome = await resolveChrome()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'kudos-chrome-'))
  await fs.mkdir(OUT_DIR, { recursive: true })

  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--no-proxy-server',
      '--proxy-bypass-list=*',
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
    await cdp.send('Network.enable')
    await cdp.send('Runtime.enable')

    const consoleErrors = []
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        const text = typeof params.text === 'string' ? params.text : JSON.stringify(params.text)
        consoleErrors.push(`console.error: ${text}`)
      }
    })
    cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails ?? {}
      consoleErrors.push(`exception: ${details.exception?.description ?? details.text ?? 'unknown'}`)
    })

    async function setViewport(width) {
      const mobile = width <= 480
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: mobile ? 2200 : 1200,
        deviceScaleFactor: mobile ? 2 : 1,
        mobile,
      })
    }

    async function capture(name, url) {
      const loaded = cdp.waitFor('Page.loadEventFired').catch(() => undefined)
      await cdp.send('Page.navigate', { url: `${BASE}${url}` })
      await loaded
      await sleep(1300)
      const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      const file = path.join(OUT_DIR, `${name}.png`)
      await fs.writeFile(file, Buffer.from(result.data, 'base64'))
      console.log(`captured ${path.relative(process.cwd(), file)}`)
    }

    // Public routes at every width (no session cookie yet).
    for (const width of WIDTHS) {
      await setViewport(width)
      for (const route of PUBLIC_ROUTES) {
        await capture(`${route.name}-${width}`, route.url)
      }
    }

    const { token, slug } = await createSession()
    await seedDemoContent(token, slug)
    for (const domain of ['127.0.0.1', 'localhost']) {
      await cdp.send('Network.setCookie', {
        name: 'kudos_session',
        value: token,
        domain,
        path: '/',
        httpOnly: true,
      })
    }
    AUTHED_ROUTES.find((route) => route.name === 'collection').url = `/t/${slug}`
    AUTHED_ROUTES.find((route) => route.name === 'wall').url = `/wall/${slug}`

    // Authed routes at every width.
    for (const width of WIDTHS) {
      await setViewport(width)
      for (const route of AUTHED_ROUTES) {
        await capture(`${route.name}-${width}`, route.url)
      }
    }

    console.log(`\nconsole errors captured: ${consoleErrors.length}`)
    for (const entry of consoleErrors) console.log(`  - ${entry}`)
  } finally {
    cdp?.close()
    child.kill()
    await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
