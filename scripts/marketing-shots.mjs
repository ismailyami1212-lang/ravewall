/**
 * Generates light-mode screenshots of the REAL agency UI for the marketing page.
 *
 * Seeds a clean demo workspace (polished client names + slugs, approved and
 * pending testimonials, live and draft widgets), then captures the dashboard
 * overview and the widgets hub at desktop size. No fabricated UI: these are the
 * actual product screens.
 *
 * Usage:
 *   PGLITE_DIR=memory PORT=3999 node scripts/dev-server.mjs   # terminal 1
 *   BASE_URL=http://127.0.0.1:3999 node scripts/marketing-shots.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3999').replace(/\/$/, '')
const OUT_DIR = path.join(process.cwd(), 'public/marketing')
const PORT = Number(process.env.CDP_PORT ?? 9224)
const VIEWPORT = { width: 1280, height: 860 }

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
  throw new Error('No Chromium binary found.')
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
    this.waiters = this.waiters.filter((w) => {
      if (w.method !== message.method) return true
      w.resolve(message.params)
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
        this.waiters = this.waiters.filter((e) => e !== waiter)
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
      const page = targets.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('Chromium did not expose a DevTools endpoint')
}

async function api(method, urlPath, { token, wsId, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Cookie = `kudos_session=${token}`
  if (wsId) headers['x-workspace-id'] = wsId
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

async function signup(email, name) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Passw0rd!', name }),
  })
  const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? ''
  const token = /kudos_session=([^;]+)/.exec(raw)?.[1]
  if (!token) throw new Error(`signup failed: ${res.status}`)
  return token
}

const CLIENTS = [
  { name: 'Northwind Studio', slug: 'northwind-studio' },
  { name: 'Lantern Health', slug: 'lantern-health' },
  { name: 'Ridgeway Partners', slug: 'ridgeway-partners' },
  { name: 'Cobalt Labs', slug: 'cobalt-labs' },
]

const TESTIMONIALS = [
  { name: 'Mara Ellis', company: 'Northwind Studio', rating: '5', text: 'They rebuilt our pricing page in a week and conversion went up 18%. The whole process was calm and predictable.', status: 'approved' },
  { name: 'Tobias Lang', company: 'Fieldnote', rating: '5', text: 'The moderation queue is the part I did not know I needed. Nothing reaches the public page until we say so.', status: 'approved' },
  { name: 'Priya Raman', company: 'Cobalt Labs', rating: '4', text: 'Set up in about two minutes, sent the link, had eleven testimonials by the next morning.', status: 'approved' },
  { name: 'Danny Okonkwo', company: 'Lantern Health', rating: '5', text: 'Our sales team now pastes real quotes into proposals instead of writing them by hand.', status: 'approved' },
  { name: 'Sofia Marchetti', company: 'Ridgeway Partners', rating: '4', text: 'Clean, fast and it looks like part of our own site rather than a third party widget.', status: 'approved' },
  { name: 'Idris Bello', company: '', rating: '5', text: 'Genuinely the simplest tool we have added this year. It just works and the wall looks great.', status: 'pending' },
  { name: 'Hannah Cole', company: 'Bright Path', rating: '3', text: 'Good product overall, though I would like more control over how the wall is sorted.', status: 'pending' },
]

async function seed() {
  const ts = Date.now().toString(36)
  const token = await signup(`marketing-${ts}@example.com`, 'Mara Ellis')
  const me = await api('GET', '/api/account', { token })
  const wsId = me.json.data.workspace.id

  const created = []
  for (const client of CLIENTS) {
    const res = await api('POST', '/api/workspace/clients', { token, wsId, body: client })
    if (res.status === 201) created.push(res.json.data.client)
  }

  const projects = (await api('GET', '/api/workspace/projects', { token, wsId })).json.data.items
  const defaultOf = (clientId) => projects.find((p) => p.clientId === clientId && p.isDefault)

  // A second project on the first client, so "projects" is visible.
  const northwind = created[0]
  const extra = await api('POST', `/api/workspace/clients/${northwind.id}/projects`, {
    token,
    wsId,
    body: { name: 'Website redesign', slug: 'northwind-website-redesign' },
  })
  const northwindProject = extra.status === 201 ? extra.json.data.project : defaultOf(northwind.id)

  // Approved + pending testimonials.
  await api('POST', `/api/projects/projects/${northwindProject.id}/import`, {
    token,
    wsId,
    body: { commit: true, rows: TESTIMONIALS },
  })
  await api('POST', `/api/projects/projects/${defaultOf(created[1].id).id}/import`, {
    token,
    wsId,
    body: {
      commit: true,
      rows: [
        { name: 'Danny Okonkwo', company: 'Lantern Health', rating: '5', text: 'Our sales team now pastes real quotes into proposals instead of writing them by hand.', status: 'approved' },
        { name: 'Aisha Rahman', company: 'Lantern Health', rating: '5', text: 'The wall looks like our own brand, which is exactly what we wanted.', status: 'approved' },
      ],
    },
  })

  // Saved widgets: two live, one draft.
  await api('POST', `/api/projects/projects/${northwindProject.id}/widgets`, {
    token,
    wsId,
    body: { name: 'Homepage carousel', layout: 'carousel', theme: 'light', accent: '#15803d', showStars: true, showCompany: true, max: 9, minRating: 4, tagId: null, status: 'live' },
  })
  await api('POST', `/api/projects/projects/${northwindProject.id}/widgets`, {
    token,
    wsId,
    body: { name: 'Footer quote', layout: 'single', theme: 'light', accent: '#15803d', showStars: true, showCompany: true, max: 1, minRating: 5, tagId: null, status: 'live' },
  })
  await api('POST', `/api/projects/projects/${northwindProject.id}/widgets`, {
    token,
    wsId,
    body: { name: 'Case study grid', layout: 'grid', theme: 'light', accent: '#15803d', showStars: true, showCompany: true, max: 12, minRating: 4, tagId: null, status: 'draft' },
  })

  return { token }
}

async function main() {
  const chrome = await resolveChrome()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'rave-marketing-'))
  await fs.mkdir(OUT_DIR, { recursive: true })

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

  const { token } = await seed()

  let cdp
  try {
    cdp = await Cdp.connect(await waitForDevTools())
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')
    await cdp.send('Runtime.enable')
    // The marketing page is light-first; capture the product in light mode.
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }],
    })

    for (const domain of ['127.0.0.1', 'localhost']) {
      await cdp.send('Network.setCookie', {
        name: 'kudos_session',
        value: token,
        domain,
        path: '/',
        httpOnly: true,
      })
    }

    const consoleErrors = []
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push(typeof p.text === 'string' ? p.text : JSON.stringify(p.text))
    })
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails ?? {}
      consoleErrors.push(d.exception?.description ?? d.text ?? 'exception')
    })

    async function shot(name, url) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        screenWidth: VIEWPORT.width,
        screenHeight: VIEWPORT.height,
        deviceScaleFactor: 1,
        mobile: false,
      })
      const loaded = cdp.waitFor('Page.loadEventFired').catch(() => undefined)
      await cdp.send('Page.navigate', { url: `${BASE}${url}` })
      await loaded
      await sleep(1800)
      const result = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      const file = path.join(OUT_DIR, `${name}.png`)
      await fs.writeFile(file, Buffer.from(result.data, 'base64'))
      console.log(`captured ${path.relative(process.cwd(), file)}`)
    }

    await shot('agency-overview', '/dashboard')
    await shot('agency-widgets', '/widgets')

    console.log(`console errors: ${consoleErrors.length}`)
    for (const error of consoleErrors) console.log(`  - ${error}`)
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
