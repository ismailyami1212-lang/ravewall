import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VALID_PASSWORD, createTestServer } from './helpers/server.js'

let server

beforeEach(async () => {
  server = await createTestServer()
})

afterEach(async () => {
  await server.cleanup()
})

const signupBody = (overrides = {}) => ({
  email: 'mara@example.com',
  password: VALID_PASSWORD,
  name: 'Mara Ellis',
  ...overrides,
})

describe('signup', () => {
  it('creates an account, starts a session and never returns the password', async () => {
    const agent = request.agent(server.app)
    const response = await agent.post('/api/auth/signup').send(signupBody()).expect(201)

    expect(response.body.data.user.email).toBe('mara@example.com')
    expect(response.body.data.user.name).toBe('Mara Ellis')
    expect(response.body.data.business).toBeNull()
    expect(JSON.stringify(response.body)).not.toContain(VALID_PASSWORD)
    expect(JSON.stringify(response.body)).not.toContain('passwordHash')

    const cookies = response.headers['set-cookie'] ?? []
    expect(cookies.join(';')).toMatch(/kudos_session=/)
    expect(cookies.join(';')).toMatch(/HttpOnly/i)

    const me = await agent.get('/api/auth/me').expect(200)
    expect(me.body.data.user.email).toBe('mara@example.com')
  })

  it('stores a hashed password, not the plaintext', async () => {
    await request(server.app).post('/api/auth/signup').send(signupBody()).expect(201)
    const [stored] = await server.sql('SELECT email, password_hash, password_salt FROM users')
    expect(stored.email).toBe('mara@example.com')
    expect(stored.password_hash).not.toContain(VALID_PASSWORD)
    expect(stored.password_hash).toHaveLength(128)
    expect(stored.password_salt).toHaveLength(32)
  })

  it('rejects a duplicate email with a field error', async () => {
    await request(server.app).post('/api/auth/signup').send(signupBody()).expect(201)
    const response = await request(server.app).post('/api/auth/signup').send(signupBody()).expect(409)
    expect(response.body.error.code).toBe('conflict')
    expect(response.body.error.fields.email).toBeDefined()
  })

  it('rejects a weak password before touching the database', async () => {
    const response = await request(server.app)
      .post('/api/auth/signup')
      .send(signupBody({ password: 'weak' }))
      .expect(400)
    expect(response.body.error.fields.password).toBeDefined()
    expect(await server.sql('SELECT 1 FROM users')).toHaveLength(0)
  })
})

describe('login', () => {
  beforeEach(async () => {
    await request(server.app).post('/api/auth/signup').send(signupBody()).expect(201)
  })

  it('signs an existing user in', async () => {
    const agent = request.agent(server.app)
    const response = await agent
      .post('/api/auth/login')
      .send({ email: 'mara@example.com', password: VALID_PASSWORD })
      .expect(200)
    expect(response.body.data.user.email).toBe('mara@example.com')
  })

  it('answers the same way for a wrong password and an unknown account', async () => {
    const wrong = await request(server.app)
      .post('/api/auth/login')
      .send({ email: 'mara@example.com', password: 'Wrong123' })
      .expect(401)
    const unknown = await request(server.app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Wrong123' })
      .expect(401)
    expect(wrong.body.error.message).toBe(unknown.body.error.message)
    expect(wrong.body.error.message).not.toMatch(/unknown|not found|no account/i)
  })

  it('treats the email as case insensitive', async () => {
    await request(server.app)
      .post('/api/auth/login')
      .send({ email: '  MARA@Example.com ', password: VALID_PASSWORD })
      .expect(200)
  })

  it('signs out and clears access', async () => {
    const agent = request.agent(server.app)
    await agent
      .post('/api/auth/login')
      .send({ email: 'mara@example.com', password: VALID_PASSWORD })
      .expect(200)

    // The beforeEach signup left a session behind, so sign-out must remove
    // exactly the session it was called with.
    const before = (await server.sql('SELECT 1 FROM sessions')).length
    await agent.post('/api/auth/logout').expect(204)
    expect(await server.sql('SELECT 1 FROM sessions')).toHaveLength(before - 1)

    const me = await agent.get('/api/auth/me').expect(200)
    expect(me.body.data.user).toBeNull()
  })

  it('revokes every session for a fresh account on sign-out', async () => {
    const agent = request.agent(server.app)
    await agent
      .post('/api/auth/signup')
      .send(signupBody({ email: 'fresh@example.com' }))
      .expect(201)

    const sessionsForFreshAccount = async () =>
      (
        await server.sql(
          `SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1`,
          ['fresh@example.com'],
        )
      ).length

    expect(await sessionsForFreshAccount()).toBe(1)
    await agent.post('/api/auth/logout').expect(204)
    expect(await sessionsForFreshAccount()).toBe(0)
  })
})

describe('session integrity', () => {
  it('ignores a forged session cookie', async () => {
    const response = await request(server.app)
      .get('/api/auth/me')
      .set('Cookie', 'kudos_session=not-a-real-token')
      .expect(200)
    expect(response.body.data.user).toBeNull()
  })

  it('never stores the raw session token', async () => {
    const response = await request(server.app)
      .post('/api/auth/signup')
      .send(signupBody())
      .expect(201)
    const rawToken = /kudos_session=([^;]+)/.exec(response.headers['set-cookie'][0])?.[1]
    expect(rawToken).toBeTruthy()
    const sessions = await server.sql('SELECT token_hash FROM sessions')
    expect(JSON.stringify(sessions)).not.toContain(rawToken)
    // An HMAC-SHA256 digest, never the cookie value itself.
    expect(sessions[0].token_hash).toHaveLength(64)
  })

  it('rejects an expired session', async () => {
    const agent = request.agent(server.app)
    await agent.post('/api/auth/signup').send(signupBody()).expect(201)
    await server.sql('UPDATE sessions SET expires_at = $1', [new Date(Date.now() - 1000)])
    const me = await agent.get('/api/auth/me').expect(200)
    expect(me.body.data.user).toBeNull()
  })
})

describe('business setup', () => {
  it('creates a business and reports the public projection', async () => {
    const agent = request.agent(server.app)
    await agent.post('/api/auth/signup').send(signupBody()).expect(201)

    const available = await agent.get('/api/business/slug-available?slug=northwind').expect(200)
    expect(available.body.data.available).toBe(true)

    const created = await agent
      .post('/api/business')
      .send({ name: 'Northwind Studio', slug: 'northwind', accentColor: '#0ea5e9' })
      .expect(201)
    expect(created.body.data.business.slug).toBe('northwind')
    expect(created.body.data.business.ownerId).toBeUndefined()

    const taken = await agent.get('/api/business/slug-available?slug=northwind').expect(200)
    expect(taken.body.data.available).toBe(false)

    const me = await agent.get('/api/auth/me').expect(200)
    expect(me.body.data.business.name).toBe('Northwind Studio')
  })

  it('refuses a second business for the same account', async () => {
    const agent = request.agent(server.app)
    await agent.post('/api/auth/signup').send(signupBody()).expect(201)
    await agent.post('/api/business').send({ name: 'A', slug: 'first-one' }).expect(201)
    await agent.post('/api/business').send({ name: 'B', slug: 'second-one' }).expect(409)
  })

  it('refuses a slug another account already owns', async () => {
    const first = request.agent(server.app)
    await first.post('/api/auth/signup').send(signupBody()).expect(201)
    await first.post('/api/business').send({ name: 'A', slug: 'shared-name' }).expect(201)

    const second = request.agent(server.app)
    await second
      .post('/api/auth/signup')
      .send(signupBody({ email: 'other@example.com' }))
      .expect(201)
    const response = await second
      .post('/api/business')
      .send({ name: 'B', slug: 'shared-name' })
      .expect(409)
    expect(response.body.error.fields.slug).toBeDefined()
  })

  it('requires authentication', async () => {
    await request(server.app).post('/api/business').send({ name: 'A', slug: 'nope' }).expect(401)
  })
})

describe('authorisation gates', () => {
  it('rejects owner endpoints for anonymous callers', async () => {
    await request(server.app).get('/api/testimonials').expect(401)
    await request(server.app).patch('/api/testimonials/tst_1').send({ status: 'approved' }).expect(401)
    await request(server.app).delete('/api/testimonials/tst_1').expect(401)
  })

  it('asks for business setup when the profile is missing', async () => {
    const agent = request.agent(server.app)
    await agent.post('/api/auth/signup').send(signupBody()).expect(201)
    const response = await agent.get('/api/testimonials').expect(409)
    expect(response.body.error.code).toBe('business_setup_required')
  })
})

describe('rate limiting', () => {
  it('throttles repeated auth attempts with a Retry-After header', async () => {
    const limited = await createTestServer({
      rateLimits: {
        auth: { windowMs: 60_000, max: 3 },
        submit: { windowMs: 60_000, max: 50 },
        api: { windowMs: 60_000, max: 500 },
      },
    })
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await request(limited.app)
          .post('/api/auth/login')
          .send({ email: 'mara@example.com', password: 'Wrong123' })
          .expect(401)
      }
      const blocked = await request(limited.app)
        .post('/api/auth/login')
        .send({ email: 'mara@example.com', password: 'Wrong123' })
        .expect(429)
      expect(blocked.body.error.code).toBe('rate_limited')
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    } finally {
      await limited.cleanup()
    }
  })
})

describe('health and fallbacks', () => {
  it('reports health without leaking internals', async () => {
    const response = await request(server.app).get('/api/health').expect(200)
    expect(response.body.data.status).toBe('ok')
    expect(response.body.data).not.toHaveProperty('dataFile')
    expect(response.body.data).not.toHaveProperty('sessionSecret')
  })

  it('returns a JSON 404 for unknown API routes', async () => {
    const response = await request(server.app).get('/api/nope').expect(404)
    expect(response.body.error.code).toBe('not_found')
  })

  it('rejects a malformed JSON body', async () => {
    const response = await request(server.app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400)
    expect(response.body.error.code).toBe('bad_request')
  })

  it('blocks cross-origin state changes', async () => {
    const response = await request(server.app)
      .post('/api/auth/signup')
      .set('Origin', 'https://evil.example.com')
      .send(signupBody())
      .expect(403)
    expect(response.body.error.code).toBe('forbidden')
  })

  it('sets hardened security headers', async () => {
    const response = await request(server.app).get('/api/health').expect(200)
    expect(response.headers['content-security-policy']).toContain("default-src 'self'")
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['x-powered-by']).toBeUndefined()
  })
})
