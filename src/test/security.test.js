/**
 * Security acceptance tests.
 *
 * These encode the guarantees the beta launch depends on: tenant isolation,
 * what an anonymous visitor can and cannot reach, and input hardening. They are
 * deliberately explicit — one assertion per promise — so a regression names the
 * exact guarantee that broke.
 */
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  VALID_PASSWORD,
  createTestServer,
  seedAccount,
  submitTestimonial,
} from './helpers/server.js'

let server
let alice
let bob
let aliceTestimonialId
let bobTestimonialId

async function idOf(agent, name) {
  const list = await agent.get('/api/testimonials?status=all').expect(200)
  return list.body.data.items.find((item) => item.name === name)?.id
}

beforeEach(async () => {
  server = await createTestServer()
  alice = await seedAccount(request, server.app, {
    email: 'alice@example.com',
    name: 'Alice',
    slug: 'alice-co',
    businessName: 'Alice Co',
  })
  bob = await seedAccount(request, server.app, {
    email: 'bob@example.com',
    name: 'Bob',
    slug: 'bob-co',
    businessName: 'Bob Co',
  })

  await submitTestimonial(server.app, 'alice-co', { name: 'AliceCustomer' })
  await submitTestimonial(server.app, 'bob-co', { name: 'BobCustomer' })
  aliceTestimonialId = await idOf(alice, 'AliceCustomer')
  bobTestimonialId = await idOf(bob, 'BobCustomer')
})

afterEach(async () => {
  await server.cleanup()
})

describe('tenant isolation', () => {
  it('never lists another tenant’s testimonials', async () => {
    const mine = await alice.get('/api/testimonials?status=all').expect(200)
    expect(mine.body.data.items.map((item) => item.name)).toEqual(['AliceCustomer'])
    expect(JSON.stringify(mine.body)).not.toContain('BobCustomer')
  })

  it('never counts another tenant’s rows in the dashboard stats', async () => {
    const stats = await alice.get('/api/testimonials?status=all').expect(200)
    expect(stats.body.data.stats.total).toBe(1)
  })

  it('cannot approve another tenant’s testimonial', async () => {
    await bob.patch(`/api/testimonials/${aliceTestimonialId}`).send({ status: 'approved' }).expect(404)
    const rows = await server.sql('SELECT status FROM testimonials WHERE id = $1', [
      aliceTestimonialId,
    ])
    expect(rows[0].status).toBe('pending')
  })

  it('cannot reject another tenant’s testimonial', async () => {
    await bob.patch(`/api/testimonials/${aliceTestimonialId}`).send({ status: 'rejected' }).expect(404)
    const rows = await server.sql('SELECT status FROM testimonials WHERE id = $1', [
      aliceTestimonialId,
    ])
    expect(rows[0].status).toBe('pending')
  })

  it('cannot delete another tenant’s testimonial', async () => {
    await bob.delete(`/api/testimonials/${aliceTestimonialId}`).expect(404)
    expect(await server.sql('SELECT 1 FROM testimonials WHERE id = $1', [aliceTestimonialId])).toHaveLength(1)
  })

  it('cannot read another tenant’s business through the owner endpoint', async () => {
    const mine = await alice.get('/api/business').expect(200)
    expect(mine.body.data.business.slug).toBe('alice-co')
  })

  it('cannot change another tenant’s settings', async () => {
    // The business is always resolved from the session, so a PATCH can only ever
    // touch the caller's own row.
    await bob.patch('/api/business').send({ name: 'Hijacked', slug: 'bob-co' }).expect(200)

    const aliceRow = await server.sql('SELECT name, slug FROM businesses WHERE slug = $1', [
      'alice-co',
    ])
    expect(aliceRow[0].name).toBe('Alice Co')
    expect(aliceRow[0].slug).toBe('alice-co')
  })

  it('cannot claim another tenant’s slug', async () => {
    const third = request.agent(server.app)
    await third
      .post('/api/auth/signup')
      .send({ email: 'third@example.com', password: VALID_PASSWORD, name: 'Third' })
      .expect(201)
    await third.post('/api/business').send({ name: 'Impostor', slug: 'alice-co' }).expect(409)
  })

  it('keeps each wall separate', async () => {
    await alice
      .patch(`/api/testimonials/${aliceTestimonialId}`)
      .send({ status: 'approved' })
      .expect(200)

    const wall = await request(server.app).get('/api/public/wall/bob-co').expect(200)
    expect(wall.body.data.testimonials).toHaveLength(0)
    expect(wall.body.data.business.name).toBe('Bob Co')
  })
})

describe('anonymous visitors', () => {
  it('can submit a testimonial to a valid slug', async () => {
    const response = await submitTestimonial(server.app, 'alice-co', { name: 'WalkIn' })
    expect(response.status).toBe(201)
    expect(response.body.data).toMatchObject({ accepted: true, status: 'pending' })
  })

  it('cannot reach the dashboard', async () => {
    await request(server.app).get('/api/testimonials').expect(401)
    await request(server.app).get('/api/business').expect(401)
    await request(server.app).get('/api/auth/me').expect(200)
  })

  it('cannot read pending testimonials', async () => {
    const wall = await request(server.app).get('/api/public/wall/alice-co').expect(200)
    expect(wall.body.data.testimonials).toHaveLength(0)
    expect(JSON.stringify(wall.body)).not.toContain('AliceCustomer')
  })

  it('cannot read rejected testimonials', async () => {
    await alice
      .patch(`/api/testimonials/${aliceTestimonialId}`)
      .send({ status: 'rejected' })
      .expect(200)

    const wall = await request(server.app).get('/api/public/wall/alice-co').expect(200)
    expect(wall.body.data.testimonials).toHaveLength(0)
  })

  it('can read approved testimonials on the wall', async () => {
    await alice
      .patch(`/api/testimonials/${aliceTestimonialId}`)
      .send({ status: 'approved' })
      .expect(200)

    const wall = await request(server.app).get('/api/public/wall/alice-co').expect(200)
    expect(wall.body.data.testimonials).toHaveLength(1)
    expect(wall.body.data.testimonials[0].name).toBe('AliceCustomer')
    expect(wall.body.data.stats).toEqual({ count: 1, averageRating: 5 })
  })

  it('cannot moderate or delete anything', async () => {
    await request(server.app)
      .patch(`/api/testimonials/${aliceTestimonialId}`)
      .send({ status: 'approved' })
      .expect(401)
    await request(server.app).delete(`/api/testimonials/${aliceTestimonialId}`).expect(401)
    expect(await server.sql('SELECT 1 FROM testimonials WHERE id = $1', [aliceTestimonialId])).toHaveLength(1)
  })

  it('cannot enumerate private business data', async () => {
    const publicBusiness = await request(server.app).get('/api/public/business/alice-co').expect(200)
    const business = publicBusiness.body.data.business

    // Only display fields. No owner linkage, no account details.
    expect(business).not.toHaveProperty('ownerId')
    expect(business).not.toHaveProperty('owner_user_id')
    expect(Object.keys(business).sort()).toEqual([
      'accentColor',
      'createdAt',
      'id',
      'logoUrl',
      'name',
      'slug',
      'tagline',
      'updatedAt',
    ])
    expect(JSON.stringify(publicBusiness.body)).not.toContain('alice@example.com')
    expect(JSON.stringify(publicBusiness.body)).not.toContain(server.config.sessionSecret)
  })

  it('cannot reach an owner endpoint by inventing a business id', async () => {
    // There is no route that accepts a business id from the client at all.
    await request(server.app).get('/api/testimonials?businessId=whatever').expect(401)
    await request(server.app).get('/api/business?ownerId=whatever').expect(401)
  })
})

describe('input hardening', () => {
  it('rejects an invalid slug', async () => {
    await request(server.app).get('/api/public/wall/Not%20A%20Slug').expect(400)
    await request(server.app).get('/api/public/wall/ab').expect(400)
    await request(server.app).get('/api/public/wall/admin').expect(400)
  })

  it('rejects an unknown slug', async () => {
    await request(server.app).get('/api/public/wall/does-not-exist').expect(404)
    await submitTestimonial(server.app, 'does-not-exist').then((response) =>
      expect(response.status).toBe(404),
    )
  })

  it('rejects a duplicate slug', async () => {
    const agent = request.agent(server.app)
    await agent
      .post('/api/auth/signup')
      .send({ email: 'dup@example.com', password: VALID_PASSWORD, name: 'Dup' })
      .expect(201)
    await agent.post('/api/business').send({ name: 'Dup', slug: 'alice-co' }).expect(409)
  })

  it('rejects missing authentication on every owner route', async () => {
    await request(server.app).get('/api/testimonials').expect(401)
    await request(server.app).post('/api/business').send({ name: 'X', slug: 'x-y-z' }).expect(401)
    await request(server.app).patch('/api/business').send({ name: 'X' }).expect(401)
    await request(server.app).patch(`/api/testimonials/${aliceTestimonialId}`).send({ status: 'approved' }).expect(401)
    await request(server.app).delete(`/api/testimonials/${aliceTestimonialId}`).expect(401)
  })

  it('rejects an expired session', async () => {
    await server.sql('UPDATE sessions SET expires_at = $1', [new Date(Date.now() - 1000)])
    await alice.get('/api/testimonials').expect(401)
  })

  it('rejects a forged session cookie', async () => {
    await request(server.app)
      .get('/api/testimonials')
      .set('Cookie', 'kudos_session=forged-token-value')
      .expect(401)
  })

  it('rejects an out-of-range rating', async () => {
    for (const rating of [0, 6, -3, 2.5, 'lots']) {
      const response = await submitTestimonial(server.app, 'alice-co', { rating })
      expect(response.status, `rating ${rating}`).toBe(400)
      expect(response.body.error.fields.rating).toBeDefined()
    }
  })

  it('rejects an empty or too-short testimonial', async () => {
    for (const text of ['', '   ', 'too short']) {
      const response = await submitTestimonial(server.app, 'alice-co', { text })
      expect(response.status).toBe(400)
      expect(response.body.error.fields.text).toBeDefined()
    }
    const missing = await request(server.app)
      .post('/api/public/submit/alice-co')
      .send({ rating: 5, name: 'A' })
      .expect(400)
    expect(missing.body.error.fields.text).toBeDefined()
  })

  it('rejects an over-long testimonial', async () => {
    const response = await submitTestimonial(server.app, 'alice-co', { text: 'x'.repeat(1001) })
    expect(response.status).toBe(400)
    expect(response.body.error.fields.text).toBeDefined()
  })

  it('rejects an over-long name and company', async () => {
    await submitTestimonial(server.app, 'alice-co', { name: 'n'.repeat(61) }).then((r) =>
      expect(r.status).toBe(400),
    )
    await submitTestimonial(server.app, 'alice-co', { company: 'c'.repeat(81) }).then((r) =>
      expect(r.status).toBe(400),
    )
  })

  it('rejects a request body larger than the limit', async () => {
    const response = await request(server.app)
      .post('/api/public/submit/alice-co')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ rating: 5, name: 'A', text: 'x'.repeat(200_000) }))
    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('payload_too_large')
  })

  it('rejects a malformed JSON body', async () => {
    const response = await request(server.app)
      .post('/api/public/submit/alice-co')
      .set('Content-Type', 'application/json')
      .send('{"rating":')
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('bad_request')
  })

  it('rejects cross-origin state changes', async () => {
    const response = await request(server.app)
      .post('/api/public/submit/alice-co')
      .set('Origin', 'https://evil.example.com')
      .send({ rating: 5, name: 'A', text: 'A perfectly reasonable testimonial body.' })
    expect(response.status).toBe(403)
  })

  it('silently discards honeypot submissions', async () => {
    const response = await submitTestimonial(server.app, 'alice-co', {
      name: 'Bot',
      website: 'https://spam.example.com',
    })
    // Indistinguishable from success, but nothing is stored.
    expect(response.status).toBe(201)
    expect(response.body.data).toMatchObject({ accepted: true, status: 'pending' })
    expect(await server.sql('SELECT 1 FROM testimonials WHERE author_name = $1', ['Bot'])).toHaveLength(0)
  })

  it('rate limits repeated submissions', async () => {
    const limited = await createTestServer({
      rateLimits: {
        auth: { windowMs: 60_000, max: 50 },
        submit: { windowMs: 60_000, max: 2 },
        api: { windowMs: 60_000, max: 500 },
      },
    })
    try {
      await seedAccount(request, limited.app, { email: 'owner@example.com', slug: 'limited-co' })
      expect((await submitTestimonial(limited.app, 'limited-co')).status).toBe(201)
      expect((await submitTestimonial(limited.app, 'limited-co')).status).toBe(201)
      const blocked = await submitTestimonial(limited.app, 'limited-co')
      expect(blocked.status).toBe(429)
      expect(blocked.headers['retry-after']).toBeDefined()
      expect(await limited.sql('SELECT 1 FROM testimonials')).toHaveLength(2)
    } finally {
      await limited.cleanup()
    }
  })

  it('rate limits repeated login attempts', async () => {
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
          .send({ email: 'nobody@example.com', password: 'Wrong123' })
          .expect(401)
      }
      await request(limited.app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'Wrong123' })
        .expect(429)
    } finally {
      await limited.cleanup()
    }
  })
})

describe('visibility rules', () => {
  it('publishes an approved testimonial and hides it again when rejected', async () => {
    const before = await request(server.app).get('/api/public/wall/alice-co').expect(200)
    expect(before.body.data.testimonials).toHaveLength(0)

    await alice
      .patch(`/api/testimonials/${aliceTestimonialId}`)
      .send({ status: 'approved' })
      .expect(200)
    const approved = await request(server.app).get('/api/public/wall/alice-co').expect(200)
    expect(approved.body.data.testimonials).toHaveLength(1)

    await alice
      .patch(`/api/testimonials/${aliceTestimonialId}`)
      .send({ status: 'rejected' })
      .expect(200)
    const rejected = await request(server.app).get('/api/public/wall/alice-co').expect(200)
    expect(rejected.body.data.testimonials).toHaveLength(0)
  })

  it('never exposes moderation metadata on the wall', async () => {
    await alice
      .patch(`/api/testimonials/${aliceTestimonialId}`)
      .send({ status: 'approved' })
      .expect(200)

    const wall = await request(server.app).get('/api/public/wall/alice-co').expect(200)
    const item = wall.body.data.testimonials[0]
    for (const forbidden of ['status', 'businessId', 'ipHash', 'userAgent', 'approvedAt']) {
      expect(item).not.toHaveProperty(forbidden)
    }
  })
})

describe('secret handling', () => {
  it('never returns credentials, hashes or config in a response', async () => {
    const responses = [
      await request(server.app).get('/api/health').expect(200),
      await request(server.app).get('/api/auth/me').expect(200),
      await request(server.app).get('/api/public/wall/alice-co').expect(200),
      await alice.get('/api/testimonials?status=all').expect(200),
    ]

    for (const response of responses) {
      const body = JSON.stringify(response.body)
      expect(body).not.toContain('postgresql://')
      expect(body).not.toContain(server.config.sessionSecret)
      expect(body).not.toContain('password_hash')
      expect(body).not.toContain('passwordHash')
      expect(body).not.toContain('token_hash')
      expect(body).not.toContain(VALID_PASSWORD)
    }
  })

  it('reports health without leaking configuration', async () => {
    const response = await request(server.app).get('/api/health').expect(200)
    expect(response.body.data).toMatchObject({ status: 'ok', database: 'ok' })
    for (const forbidden of ['dataFile', 'sessionSecret', 'databaseUrl', 'SUPABASE_DB_URL']) {
      expect(response.body.data).not.toHaveProperty(forbidden)
    }
  })

  it('never stores a plaintext session token or password', async () => {
    const sessions = await server.sql('SELECT token_hash FROM sessions')
    for (const session of sessions) expect(session.token_hash).toMatch(/^[0-9a-f]{64}$/)

    const users = await server.sql('SELECT password_hash FROM users')
    for (const user of users) {
      expect(user.password_hash).toMatch(/^[0-9a-f]{128}$/)
      expect(user.password_hash).not.toContain(VALID_PASSWORD)
    }
  })
})
