/**
 * Light-mode companion to qa-widths.mjs for RaveWall.
 *
 * Captures the key pages at 1440 under an emulated prefers-color-scheme: light
 * to confirm the redesign holds in the light theme too. Uses the running local
 * dev server (PGLITE_DIR=memory) — production data is never touched.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3999').replace(/\/$/, '')
const OUT_DIR = process.env.OUT_DIR ?? path.join(process.cwd(), 'screenshots')
const PORT = Number(process.env.CDP_PORT ?? 9223)
const CHROME = [
  process.env.CHROME_PATH,
  path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function resolveChrome() {
  for (const candidate of CHROME) {
    try { await fs.access(candidate); return candidate } catch {}
  }
  throw new Error('No Chromium binary found.')
}

class Cdp {
  constructor(s) { this.s = s; this.id = 0; this.pending = new Map(); this.waiters = []; this.listeners = new Map(); s.onmessage = (e) => this.#h(JSON.parse(e.data)) }
  static async connect(url) { const s = new WebSocket(url); await new Promise((r, rj) => { s.onopen = r; s.onerror = () => rj(new Error('cdp open failed')) }); return new Cdp(s) }
  #h(m) {
    if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); return }
    if (!m.method) return
    this.waiters = this.waiters.filter(w => { if (w.method !== m.method) return true; w.resolve(m.params); return false })
    const ls = this.listeners.get(m.method); if (ls) for (const cb of [...ls]) cb(m.params)
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.s.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.delete(id)) reject(new Error('timeout ' + method)) }, 20000) }) }
  waitFor(method, t = 15000) { return new Promise((resolve, reject) => { const w = { method, resolve }; this.waiters.push(w); setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); reject(new Error('wait ' + method)) }, t) }) }
  on(method, cb) { if (!this.listeners.has(method)) this.listeners.set(method, new Set()); this.listeners.get(method).add(cb) }
  close() { this.s.close() }
}

async function waitDev() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); const t = await r.json(); const p = t.find(x => x.type === 'page'); if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl } catch {}
    await sleep(250)
  }
  throw new Error('devtools not up')
}

async function createSession() {
  const email = `qa-light-${Date.now()}@example.com`
  const s = await fetch(`${BASE}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Passw0rd!', name: 'QA Light' }) })
  if (!s.ok) throw new Error('signup ' + s.status)
  const raw = s.headers.getSetCookie?.()[0] ?? s.headers.get('set-cookie') ?? ''
  const token = /kudos_session=([^;]+)/.exec(raw)?.[1]
  if (!token) throw new Error('no cookie')
  const slug = `qa-l-${Date.now().toString(36)}`
  await fetch(`${BASE}/api/business`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `kudos_session=${token}` }, body: JSON.stringify({ name: 'Northwind Studio', slug, tagline: 'Design studio for ambitious teams', accentColor: '#0d9488' }) })
  // Seed a couple of approved testimonials so the wall has content.
  const auth = { Cookie: `kudos_session=${token}` }
  for (const t of [
    { name: 'Mara Ellis', company: 'Northwind', text: 'They rebuilt our pricing page in a week and conversion went up 18%.', rating: 5 },
    { name: 'Tobias Lang', company: 'Fieldnote', text: 'The moderation queue is the part I did not know I needed.', rating: 5 },
    { name: 'Priya Raman', company: 'Cobalt Labs', text: 'Set up in two minutes, had eleven testimonials by morning.', rating: 4 },
  ]) {
    await fetch(`${BASE}/api/public/submit/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) })
  }
  // Approve them.
  const list = await (await fetch(`${BASE}/api/testimonials?status=pending`, { headers: auth })).json()
  for (const item of list.data?.items ?? []) {
    await fetch(`${BASE}/api/testimonials/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ status: 'approved' }) })
  }
  return { token, slug }
}

async function capture(cdp, name, url) {
  const loaded = cdp.waitFor('Page.loadEventFired').catch(() => undefined)
  await cdp.send('Page.navigate', { url: `${BASE}${url}` })
  await loaded
  await sleep(1300)
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const file = path.join(OUT_DIR, `${name}.png`)
  await fs.writeFile(file, Buffer.from(r.data, 'base64'))
  console.log('captured', path.relative(process.cwd(), file))
}

const PUBLIC = [
  { name: 'landing-light-1440', url: '/' },
  { name: 'signup-light-1440', url: '/signup' },
  { name: 'login-light-1440', url: '/login' },
  { name: 'forgot-password-light-1440', url: '/forgot-password' },
  { name: 'privacy-light-1440', url: '/privacy' },
  { name: 'terms-light-1440', url: '/terms' },
]

async function main() {
  const chrome = await resolveChrome()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'kudos-chrome-'))
  await fs.mkdir(OUT_DIR, { recursive: true })
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--no-proxy-server', '--proxy-bypass-list=*', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })

  let cdp
  try {
    cdp = await Cdp.connect(await waitDev())
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')
    await cdp.send('Runtime.enable')
    // Force light theme regardless of host OS preference.
    await cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'light' }] })
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false })

    const errors = []
    cdp.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') errors.push('console.error: ' + p.text) })
    cdp.on('Runtime.exceptionThrown', p => errors.push('exception: ' + (p.exceptionDetails?.exception?.description ?? 'unknown')))

    for (const r of PUBLIC) await capture(cdp, r.name, r.url)

    const { token, slug } = await createSession()
    for (const d of ['127.0.0.1', 'localhost']) await cdp.send('Network.setCookie', { name: 'kudos_session', value: token, domain: d, path: '/', httpOnly: true })

    await capture(cdp, 'dashboard-light-1440', '/dashboard')
    await capture(cdp, 'widgets-light-1440', '/widgets')
    await capture(cdp, 'wall-light-1440', `/wall/${slug}`)
    await capture(cdp, 'collection-light-1440', `/t/${slug}`)

    console.log(`\nconsole errors: ${errors.length}`)
    for (const e of errors) console.log('  -', e)
  } finally {
    cdp?.close()
    child.kill()
    await fs.rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
