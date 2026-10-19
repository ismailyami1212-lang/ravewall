import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../server/config.js'
import { describeEmailMode, isTestSender, renderResetEmail, sendEmail } from '../server/email.js'
import { createTestServer, seedAccount } from './helpers/server.js'

const MESSAGE = {
  to: 'mara@example.com',
  subject: 'Reset your RaveWall password',
  html: '<p>hello</p>',
  text: 'hello',
}

const silentLogger = { log() {}, warn() {}, error() {} }

function stubResend({ ok = true, status = 200 } = {}) {
  const mock = vi.fn(async () => ({ ok, status, json: async () => ({ id: 'email_123' }) }))
  vi.stubGlobal('fetch', mock)
  return mock
}

let emailLog

beforeEach(async () => {
  emailLog = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'ravewall-email-')), 'mail.log')
  delete process.env.DEV_EMAIL_LOG
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.DEV_EMAIL_LOG
})

describe('email transport selection', () => {
  it('uses the development transport and writes to DEV_EMAIL_LOG when no key is set', async () => {
    process.env.DEV_EMAIL_LOG = emailLog
    const result = await sendEmail(MESSAGE, {
      resendApiKey: null,
      emailFrom: 'RaveWall <onboarding@resend.dev>',
      logger: silentLogger,
    })
    expect(result).toEqual({ delivered: true, transport: 'development' })

    const lines = (await fsp.readFile(emailLog, 'utf8')).trim().split('\n')
    const record = JSON.parse(lines[0])
    expect(record.to).toBe('mara@example.com')
    expect(record.subject).toBe('Reset your RaveWall password')
    expect(record.text).toBe('hello')
  })

  it('posts the exact Resend payload when a key is configured', async () => {
    const fetchMock = stubResend()
    const result = await sendEmail(MESSAGE, {
      resendApiKey: 'test-key-value',
      emailFrom: 'RaveWall <onboarding@resend.dev>',
      logger: silentLogger,
    })
    expect(result).toEqual({ delivered: true, transport: 'resend' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toMatch(/^Bearer /)
    const body = JSON.parse(init.body)
    expect(body.from).toBe('RaveWall <onboarding@resend.dev>')
    expect(body.to).toEqual(['mara@example.com'])
    expect(body.subject).toBe('Reset your RaveWall password')
    expect(body.html).toBe('<p>hello</p>')
    expect(body.text).toBe('hello')
  })

  it('reports a provider failure without throwing', async () => {
    stubResend({ ok: false, status: 422 })
    const result = await sendEmail(MESSAGE, {
      resendApiKey: 'test-key-value',
      emailFrom: 'RaveWall <onboarding@resend.dev>',
      logger: silentLogger,
    })
    expect(result.delivered).toBe(false)
    expect(result.detail).toBe('status 422')
  })

  it('reports a network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('socket hang up')
    }))
    const result = await sendEmail(MESSAGE, {
      resendApiKey: 'test-key-value',
      emailFrom: 'RaveWall <onboarding@resend.dev>',
      logger: silentLogger,
    })
    expect(result.delivered).toBe(false)
    expect(result.detail).toBe('socket hang up')
  })
})

describe('test-recipient guard', () => {
  it('skips any recipient other than the configured test address', async () => {
    const fetchMock = stubResend()
    const result = await sendEmail(MESSAGE, {
      resendApiKey: 'test-key-value',
      emailFrom: 'RaveWall <onboarding@resend.dev>',
      emailTestRecipient: 'owner@example.com',
      logger: silentLogger,
    })
    expect(result.skipped).toBe(true)
    expect(result.delivered).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('delivers to the configured test address, case-insensitively', async () => {
    const fetchMock = stubResend()
    const result = await sendEmail(
      { ...MESSAGE, to: 'Owner@Example.com' },
      {
        resendApiKey: 'test-key-value',
        emailFrom: 'RaveWall <onboarding@resend.dev>',
        emailTestRecipient: 'owner@example.com',
        logger: silentLogger,
      },
    )
    expect(result.delivered).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not interfere with the development transport', async () => {
    process.env.DEV_EMAIL_LOG = emailLog
    const result = await sendEmail(MESSAGE, {
      resendApiKey: null,
      emailFrom: 'RaveWall <onboarding@resend.dev>',
      emailTestRecipient: 'owner@example.com',
      logger: silentLogger,
    })
    expect(result.transport).toBe('development')
  })
})

describe('email mode description', () => {
  it('detects the development mode', () => {
    expect(describeEmailMode({ resendApiKey: null, emailFrom: 'x' })).toEqual({
      mode: 'development',
      testSender: false,
      testRecipient: null,
    })
  })

  it('detects the shared test sender', () => {
    const mode = describeEmailMode({
      resendApiKey: 'k',
      emailFrom: 'RaveWall <onboarding@resend.dev>',
      emailTestRecipient: 'owner@example.com',
    })
    expect(mode.mode).toBe('test-sender')
    expect(mode.testSender).toBe(true)
    expect(mode.testRecipient).toBe('owner@example.com')
  })

  it('detects a verified-domain sender', () => {
    const mode = describeEmailMode({
      resendApiKey: 'k',
      emailFrom: 'RaveWall <hello@ravewall.example>',
    })
    expect(mode.mode).toBe('verified-domain')
    expect(mode.testSender).toBe(false)
  })

  it('never contains the key', () => {
    const mode = describeEmailMode({ resendApiKey: 'super-secret-key', emailFrom: 'x' })
    expect(JSON.stringify(mode)).not.toContain('super-secret-key')
  })

  it('isTestSender only matches resend.dev addresses', () => {
    expect(isTestSender('RaveWall <onboarding@resend.dev>')).toBe(true)
    expect(isTestSender('RaveWall <hello@ravewall.vercel.app>')).toBe(false)
    expect(isTestSender('')).toBe(false)
  })
})

describe('configuration defaults', () => {
  it('defaults EMAIL_FROM to the Resend test sender, never a RaveWall domain', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      SUPABASE_DB_URL: 'postgresql://u:p@127.0.0.1:5432/db',
      SESSION_SECRET: 'x'.repeat(40),
    })
    expect(config.emailFrom).toBe('RaveWall <onboarding@resend.dev>')
    expect(config.emailTestRecipient).toBeNull()
    expect(config.resendApiKey).toBeNull()
  })

  it('normalises EMAIL_TEST_RECIPIENT and reads EMAIL_FROM', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      SUPABASE_DB_URL: 'postgresql://u:p@127.0.0.1:5432/db',
      SESSION_SECRET: 'x'.repeat(40),
      EMAIL_FROM: 'RaveWall <hello@example.com>',
      EMAIL_TEST_RECIPIENT: '  Owner@Example.COM  ',
    })
    expect(config.emailFrom).toBe('RaveWall <hello@example.com>')
    expect(config.emailTestRecipient).toBe('owner@example.com')
  })
})

describe('forgot-password with the test-sender guard', () => {
  it('still answers enumeration-safely and never attempts a send to a real user', async () => {
    const server = await createTestServer({
      resendApiKey: 'test-key-value',
      emailFrom: 'RaveWall <onboarding@resend.dev>',
      emailTestRecipient: 'owner@example.com',
    })
    const fetchMock = stubResend()
    try {
      await seedAccount(request, server.app, {
        email: 'mara@example.com',
        name: 'Mara Ellis',
        slug: 'northwind',
        businessName: 'Northwind Studio',
      })

      const existing = await request(server.app)
        .post('/api/auth/forgot-password')
        .send({ email: 'mara@example.com' })
        .expect(202)
      const unknown = await request(server.app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nobody@example.com' })
        .expect(202)

      expect(existing.body).toEqual(unknown.body)
      expect(existing.body.data.message).toMatch(/if an account exists/i)
      // The guard prevented the provider call entirely.
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      await server.cleanup()
    }
  })

  it('sends to the configured test recipient and produces a usable token', async () => {
    const server = await createTestServer({
      resendApiKey: 'test-key-value',
      emailFrom: 'RaveWall <onboarding@resend.dev>',
      emailTestRecipient: 'mara@example.com',
    })
    const fetchMock = stubResend()
    try {
      await seedAccount(request, server.app, {
        email: 'mara@example.com',
        name: 'Mara Ellis',
        slug: 'northwind',
        businessName: 'Northwind Studio',
      })

      await request(server.app)
        .post('/api/auth/forgot-password')
        .send({ email: 'mara@example.com' })
        .expect(202)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.to).toEqual(['mara@example.com'])
      expect(body.from).toContain('@resend.dev')

      const tokenMatch = /reset-password\?token=([^\s"<]+)/.exec(body.text)
      expect(tokenMatch).toBeTruthy()
      const token = decodeURIComponent(tokenMatch[1])

      await request(server.app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'Brandnewpass1' })
        .expect(200)
    } finally {
      await server.cleanup()
    }
  })
})

describe('reset email template', () => {
  it('mentions expiry and the ignore path, and includes no marketing', () => {
    const { html, text } = renderResetEmail('https://example.com/reset-password?token=abc', 60)
    expect(text).toContain('60 minutes')
    expect(text).toMatch(/ignore this email/i)
    expect(html).not.toMatch(/unsubscribe|newsletter|offer/i)
  })
})
