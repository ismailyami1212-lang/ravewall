import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderResetEmail } from '../server/email.js'
import { VALID_PASSWORD, createTestServer, seedAccount } from './helpers/server.js'

const SECRET = 'test-session-secret-that-is-long-enough-to-pass'

let server
let owner
let emailLog

beforeEach(async () => {
  emailLog = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'ravewall-reset-')), 'emails.log')
  process.env.DEV_EMAIL_LOG = emailLog
  server = await createTestServer()
  owner = await seedAccount(request, server.app, {
    email: 'mara@example.com',
    name: 'Mara Ellis',
    slug: 'northwind',
    businessName: 'Northwind Studio',
  })
})

afterEach(async () => {
  delete process.env.DEV_EMAIL_LOG
  await server.cleanup()
})

/** Reads the most recent reset URL from the development email log. */
async function latestResetUrl() {
  const raw = await fsp.readFile(emailLog, 'utf8')
  const lines = raw.trim().split('\n').filter(Boolean)
  const records = lines.map((line) => JSON.parse(line))
  const match = /reset-password\?token=([^\s]+)/.exec(records[records.length - 1].text)
  return match ? decodeURIComponent(match[1]) : null
}

async function requestReset(email, expected = 202) {
  const response = await request(server.app).post('/api/auth/forgot-password').send({ email })
  expect(response.status).toBe(expected)
  return response
}

describe('password reset request', () => {
  it('responds identically for an existing and an unknown account', async () => {
    const existing = await requestReset('mara@example.com', 202)
    const unknown = await requestReset('nobody@example.com', 202)
    expect(unknown.body).toEqual(existing.body)
    expect(existing.body.data.ok).toBe(true)
    expect(existing.body.data.message).toMatch(/if an account exists/i)
  })

  it('builds the reset link from APP_URL, never the request Host header', async () => {
    await request(server.app)
      .post('/api/auth/forgot-password')
      .set('Host', 'attacker.example')
      .send({ email: 'mara@example.com' })
      .expect(202)

    const raw = await fsp.readFile(emailLog, 'utf8')
    const records = raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    const email = records[records.length - 1]
    expect(email.text).toContain(`${server.config.appUrl}/reset-password?token=`)
    expect(email.text).not.toContain('attacker.example')
  })

  it('stores only an HMAC of the token — never the raw value', async () => {
    await requestReset('mara@example.com', 202)
    const token = await latestResetUrl()
    expect(token).toBeTruthy()

    const rows = await server.sql('SELECT token_hash FROM password_resets')
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).not.toContain(token)
    const expectedHash = crypto.createHmac('sha256', SECRET).update(token).digest('hex')
    expect(rows[0].token_hash).toBe(expectedHash)
  })

  it('does not create a reset row for an unknown email', async () => {
    await requestReset('nobody@example.com', 202)
    const rows = await server.sql('SELECT id FROM password_resets')
    expect(rows).toHaveLength(0)
  })

  it('rejects a malformed email', async () => {
    await requestReset('not-an-email', 400)
  })

  it('rate limits repeated requests for the same email', async () => {
    for (let i = 0; i < 10; i += 1) {
      await requestReset('mara@example.com', 202)
    }
    await requestReset('mara@example.com', 429)
  })

  it('invalidates earlier tokens when a new one is requested', async () => {
    await requestReset('mara@example.com', 202)
    await requestReset('mara@example.com', 202)
    const rows = await server.sql('SELECT id FROM password_resets')
    expect(rows).toHaveLength(1)
  })
})

describe('password reset confirmation', () => {
  it('resets the password, ends sessions and enforces single use', async () => {
    const cookie = owner.get('/api/auth/me')
    expect((await cookie).body.data.user).not.toBeNull()

    await requestReset('mara@example.com', 202)
    const token = await latestResetUrl()

    const reset = await request(server.app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'Brandnewpass1' })
      .expect(200)
    expect(reset.body.data.ok).toBe(true)
    expect(reset.body.data.sessionsEnded).toBeGreaterThanOrEqual(1)

    // The old session cookie no longer authenticates.
    const me = await owner.get('/api/auth/me').expect(200)
    expect(me.body.data.user).toBeNull()

    // New password works, old one does not.
    const login = await request(server.app)
      .post('/api/auth/login')
      .send({ email: 'mara@example.com', password: 'Brandnewpass1' })
      .expect(200)
    expect(login.body.data.user.email).toBe('mara@example.com')

    await request(server.app)
      .post('/api/auth/login')
      .send({ email: 'mara@example.com', password: VALID_PASSWORD })
      .expect(401)

    // The token cannot be used twice.
    await request(server.app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'Anotherpass2' })
      .expect(400)
  })

  it('rejects a tampered token', async () => {
    await requestReset('mara@example.com', 202)
    const token = await latestResetUrl()
    const tampered = `${token.slice(0, -2)}xy`
    await request(server.app)
      .post('/api/auth/reset-password')
      .send({ token: tampered, password: 'Brandnewpass1' })
      .expect(400)
  })

  it('rejects a malformed token', async () => {
    await request(server.app)
      .post('/api/auth/reset-password')
      .send({ token: 'not-a-real-token', password: 'Brandnewpass1' })
      .expect(400)
  })

  it('rejects an expired token', async () => {
    const rawToken = crypto.randomBytes(32).toString('base64url')
    const tokenHash = crypto.createHmac('sha256', SECRET).update(rawToken).digest('hex')
    const [user] = await server.sql('SELECT id FROM users')
    await server.sql(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() - interval '1 minute')`,
      [user.id, tokenHash],
    )
    await request(server.app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'Brandnewpass1' })
      .expect(400)
  })

  it('rejects an already-used token', async () => {
    const rawToken = crypto.randomBytes(32).toString('base64url')
    const tokenHash = crypto.createHmac('sha256', SECRET).update(rawToken).digest('hex')
    const [user] = await server.sql('SELECT id FROM users')
    await server.sql(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, used_at)
       VALUES ($1, $2, now() + interval '1 hour', now())`,
      [user.id, tokenHash],
    )
    await request(server.app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, password: 'Brandnewpass1' })
      .expect(400)
  })

  it('enforces the password rules on reset', async () => {
    await requestReset('mara@example.com', 202)
    const token = await latestResetUrl()
    const response = await request(server.app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'short' })
      .expect(400)
    expect(response.body.error.fields.password).toMatch(/at least 8 characters/i)
  })

  it('rate limits repeated reset attempts with invalid tokens', async () => {
    // The signup in beforeEach already consumed one slot of the shared,
    // IP-keyed auth bucket, so nine more attempts fill the ceiling of ten.
    for (let i = 0; i < 9; i += 1) {
      await request(server.app)
        .post('/api/auth/reset-password')
        .send({ token: `bogus-token-${i}`, password: 'Brandnewpass1' })
        .expect(400)
    }
    await request(server.app)
      .post('/api/auth/reset-password')
      .send({ token: 'bogus-final', password: 'Brandnewpass1' })
      .expect(429)
  })
})

describe('reset email template', () => {
  it('renders a plain-text and HTML version with the link and expiry', () => {
    const { html, text } = renderResetEmail('https://ravewall.vercel.app/reset-password?token=abc', 60)
    expect(text).toContain('https://ravewall.vercel.app/reset-password?token=abc')
    expect(text).toContain('60 minutes')
    expect(text).toMatch(/ignore this email/i)
    expect(html).toContain('href="https://ravewall.vercel.app/reset-password?token=abc"')
    expect(html).toContain('Choose a new password')
    expect(html).toContain('#15803d')
  })
})
