/**
 * Agency-console visual QA against a LOCAL PGlite dev server.
 *
 * Bootstraps a realistic workspace (several clients, projects, a tag, a custom
 * question, a saved widget, imported testimonials, a manager on the team) and
 * captures the new agency pages at the required viewports:
 *   1440 / 1280 / 1024 / 768 / 390 / 360
 *
 * Collects console errors + page exceptions and prints a summary. NEVER touches
 * production: point BASE_URL at the local dev server only.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3999 node scripts/qa-agency.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3999').replace(/\/$/, '')
const OUT_DIR = process.env.OUT_DIR ?? path.join(process.cwd(), 'screenshots/agency')
const PORT = Number(process.env.CDP_PORT ?? 9223)
const VIEWPORT_HEIGHT = 1100

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

// --------------------------------------------------------------- minimal CDP
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

// --------------------------------------------------------------- API helpers
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
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json }
}

async function signup(email, name) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Passw0rd!', name }),
  })
  const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? ''
  const token = /kudos_session=([^;]+)/.exec(raw)?.[1]
  if (!token) throw new Error(`signup failed for ${email}: ${res.status}`)
  return token
}

async function bootstrap() {
  const ts = Date.now().toString(36)
  const ownerEmail = `owner-${ts}@example.com`
  const ownerToken = await signup(ownerEmail, 'Agency Owner')
  const mgrEmail = `mgr-${ts}@example.com`
  await signup(mgrEmail, 'Mara Manager')

  const me = await api('GET', '/api/account', { token: ownerToken })
  const wsId = me.json.data.workspace.id

  // Default client (the business) + a couple more clients.
  await api('POST', '/api/business', {
    token: ownerToken,
    wsId,
    body: { name: 'Northwind Studio', slug: `northwind-${ts}`, tagline: 'Design studio for ambitious teams', accentColor: '#15803d' },
  })
  const clientsRes = await api('GET', '/api/workspace/clients', { token: ownerToken, wsId })
  const clients = clientsRes.json.data.items
  const defaultClient = clients[0]

  const extra = [
    { name: 'Lantern Health', accent: '#0ea5e9' },
    { name: 'Ridgeway Partners', accent: '#f59e0b' },
    { name: 'Cobalt Labs', accent: '#7c3aed' },
  ]
  for (const c of extra) {
    const r = await api('POST', '/api/workspace/clients', {
      token: ownerToken,
      wsId,
      body: { name: c.name, slug: c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + `-${ts}` },
    })
    if (r.status === 201) clients.push(r.json.data.client)
  }

  // A project on the default client.
  const projRes = await api('POST', `/api/workspace/clients/${defaultClient.id}/projects`, {
    token: ownerToken,
    wsId,
    body: { name: 'Spring Campaign', slug: `spring-${ts}` },
  })
  const project = projRes.json.data.project

  // ClientDetail picks the default (auto-created) project as the active tab.
  // Populate it too, so Questions / Widgets / Analytics tabs are not empty.
  const clientDetail = await api('GET', `/api/workspace/clients/${defaultClient.id}`, { token: ownerToken, wsId })
  const defaultProject = clientDetail.json.data.projects.find((p) => p.isDefault) ?? clientDetail.json.data.projects[0]

  // A tag, a custom question and a saved widget on that project.
  // The content router mounts at /api/projects AND its project-scoped routes
  // are defined as /projects/:projectId/..., so the actual path is doubled
  // (e.g. /api/projects/projects/:id/questions). contentApi in api.ts uses
  // the same doubled segment; this script must match the live contract.
  await api('POST', '/api/projects/tags', { token: ownerToken, wsId, body: { name: 'Case study' } })
  await api('POST', `/api/projects/projects/${project.id}/questions`, {
    token: ownerToken,
    wsId,
    body: { label: 'What outcome mattered most?', type: 'text', required: false, position: 0 },
  })
  const springWidget = await api('POST', `/api/projects/projects/${project.id}/widgets`, {
    token: ownerToken,
    wsId,
    body: {
      name: 'Wall of love',
      layout: 'grid',
      theme: 'light',
      accent: '#15803d',
      showStars: true,
      showCompany: true,
      max: 12,
      minRating: 4,
      tagId: null,
      status: 'draft',
    },
  })

  // Same on the default project so the active tab in ClientDetail has content.
  await api('POST', `/api/projects/projects/${defaultProject.id}/questions`, {
    token: ownerToken,
    wsId,
    body: { label: 'Anything you would tell a friend about us?', type: 'long', required: false, position: 0 },
  })
  await api('POST', `/api/projects/projects/${defaultProject.id}/widgets`, {
    token: ownerToken,
    wsId,
    body: {
      name: 'Homepage wall',
      layout: 'carousel',
      theme: 'light',
      accent: '#0ea5e9',
      showStars: true,
      showCompany: true,
      max: 8,
      minRating: 4,
      tagId: null,
      status: 'live',
    },
  })

  // Import a handful of testimonials into the project.
  // Import schema requires every row value to be a string (it parses the
  // rating internally and mirrors the shape of pasted CSV cells).
  const rows = [
    { name: 'Mara Ellis', company: 'Northwind Studio', rating: '5', text: 'They rebuilt our pricing page in a week and conversion went up 18%. The whole process was calm and predictable.', status: 'approved' },
    { name: 'Tobias Lang', company: 'Fieldnote', rating: '5', text: 'The moderation queue is the part I did not know I needed. Nothing reaches the public page until we say so.', status: 'approved' },
    { name: 'Priya Raman', company: 'Cobalt Labs', rating: '4', text: 'Set up in about two minutes, sent the link, had eleven testimonials by the next morning.', status: 'approved' },
    { name: 'Danny Okonkwo', company: 'Lantern Health', rating: '5', text: 'Our sales team now pastes real quotes into proposals instead of writing them by hand.', status: 'approved' },
    { name: 'Sofia Marchetti', company: 'Ridgeway Partners', rating: '4', text: 'Clean, fast and it looks like part of our own site rather than a third party widget.', status: 'approved' },
    { name: 'Idris Bello', company: '', rating: '5', text: 'Genuinely the simplest tool we have added this year. It just works and the wall looks great.', status: 'pending' },
    { name: 'Hannah Cole', company: 'Bright Path', rating: '3', text: 'Good product overall, though I would like more control over how the wall is sorted.', status: 'pending' },
    { name: 'Spam Bot', company: 'Cheap Deals', rating: '1', text: 'BUY CHEAP FOLLOWERS AT OUR SITE NOW, BEST PRICES GUARANTEED FOR ALL ACCOUNTS.', status: 'rejected' },
  ]
  await api('POST', `/api/projects/projects/${project.id}/import`, {
    token: ownerToken,
    wsId,
    body: { commit: true, rows },
  })

  // Approved testimonials on the default project so the editor preview (which
  // renders the client slug) and the live widget both have content.
  await api('POST', `/api/projects/projects/${defaultProject.id}/import`, {
    token: ownerToken,
    wsId,
    body: {
      commit: true,
      rows: [
        { name: 'Mara Ellis', company: 'Northwind Studio', rating: '5', text: 'They rebuilt our pricing page in a week and conversion went up 18%.', status: 'approved' },
        { name: 'Tobias Lang', company: 'Fieldnote', rating: '5', text: 'The moderation queue is the part I did not know I needed.', status: 'approved' },
        { name: 'Priya Raman', company: 'Cobalt Labs', rating: '4', text: 'Set up in about two minutes and had testimonials the next morning.', status: 'approved' },
      ],
    },
  })

  // Add the manager to the team.
  await api('POST', '/api/workspace/team', { token: ownerToken, wsId, body: { email: mgrEmail, role: 'manager' } })

  return { ownerToken, wsId, defaultClient, project, springWidgetId: springWidget.json.data.widget.id }
}

/** A brand-new account with one client and no testimonials/widgets (onboarding). */
async function bootstrapFresh() {
  const ts = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const token = await signup(`fresh-${ts}@example.com`, 'Fresh Owner')
  const me = await api('GET', '/api/account', { token })
  const wsId = me.json.data.workspace.id
  await api('POST', '/api/business', {
    token,
    wsId,
    body: { name: 'Fresh Client', slug: `fresh-${ts}`, accentColor: '#15803d' },
  })
  return { token }
}

async function main() {
  const chrome = await resolveChrome()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'rave-agency-'))
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

  const scenario = await bootstrap()

  let cdp
  try {
    cdp = await Cdp.connect(await waitForDevTools())
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')
    await cdp.send('Runtime.enable')

    const consoleErrors = []
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        const text = typeof p.text === 'string' ? p.text : JSON.stringify(p.text)
        consoleErrors.push(`console.error: ${text}`)
      }
    })
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails ?? {}
      consoleErrors.push(`exception: ${d.exception?.description ?? d.text ?? 'unknown'}`)
    })

    // Seed the session cookie into the browser.
    for (const domain of ['127.0.0.1', 'localhost']) {
      await cdp.send('Network.setCookie', {
        name: 'kudos_session',
        value: scenario.ownerToken,
        domain,
        path: '/',
        httpOnly: true,
      })
    }

    async function capture(name, url, width) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: VIEWPORT_HEIGHT,
        // screenWidth/screenHeight keep `window.innerWidth` equal to the
        // requested width under mobile emulation (otherwise Chrome falls back
        // to a wider default layout viewport and the shot is clipped).
        screenWidth: width,
        screenHeight: VIEWPORT_HEIGHT,
        deviceScaleFactor: 1,
        // Desktop-mode width emulation keeps `innerWidth` equal to `width` and
        // still triggers every width-based media query. (Chrome's `mobile:true`
        // path falls back to a wider layout viewport for this page.)
        mobile: false,
      })
      const loaded = cdp.waitFor('Page.loadEventFired').catch(() => undefined)
      await cdp.send('Page.navigate', { url: `${BASE}${url}` })
      await loaded
      await sleep(1600)
      const result = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      })
      const file = path.join(OUT_DIR, `${name}.png`)
      await fs.writeFile(file, Buffer.from(result.data, 'base64'))
      console.log(`captured ${path.relative(process.cwd(), file)}`)
    }

    /** Reports horizontal overflow for the currently loaded page. */
    async function probeOverflow(label) {
      const probe = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const vw = window.innerWidth;
          const offenders = [];
          document.querySelectorAll('*').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.right > vw + 1 && r.width > 0) {
              offenders.push(el.tagName + '.' + String(el.className || '').slice(0, 34) + ' right=' + Math.round(r.right));
            }
          });
          return JSON.stringify({ label: '${label}', vw, scrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 10) });
        })()`,
        returnByValue: true,
      })
      console.log('OVERFLOW', probe.result.value)
    }

    const widths = [1440, 1280, 1024, 768, 390, 360]
    const cId = scenario.defaultClient.id
    const pId = scenario.project.id

    // Clients list — every width (now with per-client counts + search).
    for (const w of widths) await capture(`clients-${w}`, '/clients', w)

    // Saved widgets hub + editor — the primary new surface.
    await capture('widgets-1440', '/widgets', 1440)
    await capture('widgets-1024', '/widgets', 1024)
    await capture('widgets-390', '/widgets', 390)
    await capture('widgets-360', '/widgets', 360)
    await probeOverflow('widgets-360')
    await capture('widgets-editor-1440', `/widgets?widgetId=${scenario.springWidgetId}`, 1440)
    await capture('widgets-editor-390', `/widgets?widgetId=${scenario.springWidgetId}`, 390)
    await capture('widgets-new-1440', `/widgets?clientId=${cId}&new=1`, 1440)

    // Dashboard with the agency overview + onboarding checklist.
    await capture('dashboard-overview-1440', '/dashboard', 1440)
    await capture('dashboard-overview-768', '/dashboard', 768)
    await capture('dashboard-overview-390', '/dashboard', 390)
    await capture('dashboard-overview-360', '/dashboard', 360)
    await probeOverflow('dashboard-360')

    // Onboarding checklist on a brand-new account (1 of 5 done).
    const fresh = await bootstrapFresh()
    for (const domain of ['127.0.0.1', 'localhost']) {
      await cdp.send('Network.setCookie', {
        name: 'kudos_session',
        value: fresh.token,
        domain,
        path: '/',
        httpOnly: true,
      })
    }
    await capture('onboarding-1440', '/dashboard', 1440)
    await capture('onboarding-390', '/dashboard', 390)

    // Client detail (overview) — representative widths.
    await capture('clientdetail-1440', `/clients/${cId}`, 1440)
    await capture('clientdetail-1024', `/clients/${cId}`, 1024)
    await capture('clientdetail-390', `/clients/${cId}`, 390)

    // Client detail with the Questions tab clicked (validates tab switching).
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: VIEWPORT_HEIGHT, deviceScaleFactor: 1, mobile: false })
    {
      const loaded = cdp.waitFor('Page.loadEventFired').catch(() => undefined)
      await cdp.send('Page.navigate', { url: `${BASE}/clients/${cId}` })
      await loaded
      await sleep(1400)
      await cdp.send('Runtime.evaluate', {
        expression:
          "Array.from(document.querySelectorAll('button')).find(b=>/questions/i.test(b.textContent))?.click(); true",
        returnByValue: true,
      })
      await sleep(800)
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      await fs.writeFile(path.join(OUT_DIR, 'clientdetail-questions-1440.png'), Buffer.from(r.data, 'base64'))
      console.log('captured screenshots/agency/clientdetail-questions-1440.png')
    }

    // Team — desktop, tablet, mobile.
    await capture('team-1440', '/team', 1440)
    await capture('team-768', '/team', 768)
    await capture('team-390', '/team', 390)

    // Analytics.
    await capture('analytics-1440', '/analytics', 1440)
    await capture('analytics-390', '/analytics', 390)

    // Account.
    await capture('account-1440', '/account', 1440)
    await capture('account-390', '/account', 390)

    // Dashboard scoped to the client + project.
    await capture('dashboard-scope-1440', `/dashboard?clientId=${cId}&projectId=${pId}`, 1440)
    await capture('dashboard-scope-768', `/dashboard?clientId=${cId}&projectId=${pId}`, 768)
    await capture('dashboard-scope-390', `/dashboard?clientId=${cId}&projectId=${pId}`, 390)

    console.log(`\nconsole errors captured: ${consoleErrors.length}`)
    for (const e of consoleErrors) console.log(`  - ${e}`)
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
