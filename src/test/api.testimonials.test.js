import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestServer, seedAccount, submitTestimonial, VALID_PASSWORD } from './helpers/server.js'

let server
let owner
let other

beforeEach(async () => {
  server = await createTestServer()
  owner = await seedAccount(request, server.app, {
    email: 'mara@example.com',
    name: 'Mara Ellis',
    slug: 'northwind',
    businessName: 'Northwind Studio',
  })
  other = await seedAccount(request, server.app, {
    email: 'tobias@example.com',
    name: 'Tobias Lang',
    slug: 'fieldnote',
    businessName: 'Fieldnote',
  })
})

afterEach(async () => {
  await server.cleanup()
})

async function submit(overrides = {}, slug = 'northwind') {
  const response = await submitTestimonial(server.app, slug, overrides)
  expect(response.status).toBe(201)
  return response.body.data
}

async function firstId() {
  const response = await owner.get('/api/testimonials?status=all').expect(200)
  return response.body.data.items[0].id
}

describe('public submission', () => {
  it('accepts a submission and stores it as pending', async () => {
    const result = await submit({ rating: 4, name: 'Priya', company: 'Cobalt Labs' })
    expect(result.status).toBe('pending')

    const [stored] = await server.sql('SELECT * FROM testimonials')
    expect(stored.status).toBe('pending')
    expect(stored.rating).toBe(4)
    expect(stored.company).toBe('Cobalt Labs')
    expect(stored.approved_at).toBeNull()
    const [business] = await server.sql('SELECT id FROM businesses WHERE slug = $1', ['northwind'])
    expect(stored.business_id).toBe(business.id)
  })

  it('never exposes a pending testimonial on the public wall', async () => {
    await submit()
    const wall = await request(server.app).get('/api/public/wall/northwind').expect(200)
    expect(wall.body.data.testimonials).toHaveLength(0)
    expect(wall.body.data.stats).toEqual({ count: 0, averageRating: 0 })
  })

  it('rejects invalid submissions with per-field messages', async () => {
    const missingRating = await request(server.app)
      .post('/api/public/submit/northwind')
      .send({ name: 'A', text: 'This text is long enough to pass.' })
      .expect(400)
    expect(missingRating.body.error.fields.rating).toBeDefined()

    const badRating = await request(server.app)
      .post('/api/public/submit/northwind')
      .send({ rating: 9, name: 'A', text: 'This text is long enough to pass.' })
      .expect(400)
    expect(badRating.body.error.fields.rating).toBeDefined()

    const shortText = await request(server.app)
      .post('/api/public/submit/northwind')
      .send({ rating: 5, name: 'A', text: 'too short' })
      .expect(400)
    expect(shortText.body.error.fields.text).toBeDefined()

    expect(await server.sql('SELECT 1 FROM testimonials')).toHaveLength(0)
  })

  it('accepts an empty company but rejects an over-long one', async () => {
    await submit({ company: '' })
    await request(server.app)
      .post('/api/public/submit/northwind')
      .send({ rating: 5, name: 'A', company: 'x'.repeat(81), text: 'A perfectly fine testimonial.' })
      .expect(400)
  })

  it('silently drops honeypot submissions', async () => {
    const response = await request(server.app)
      .post('/api/public/submit/northwind')
      .send({
        rating: 5,
        name: 'Bot',
        text: 'This looks like a real testimonial but is not.',
        website: 'https://spam.example.com',
      })
      .expect(201)
    expect(response.body.data.accepted).toBe(true)
    expect(await server.sql('SELECT 1 FROM testimonials')).toHaveLength(0)
  })

  it('404s for an unknown collection link', async () => {
    await request(server.app).post('/api/public/submit/does-not-exist').send({
      rating: 5,
      name: 'A',
      text: 'A perfectly fine testimonial.',
    }).expect(404)
    await request(server.app).get('/api/public/wall/does-not-exist').expect(404)
    await request(server.app).get('/api/public/business/does-not-exist').expect(404)
  })

  it('validates the slug before hitting the store', async () => {
    await request(server.app).get('/api/public/wall/Not%20A%20Slug').expect(400)
  })
})

describe('moderation flow', () => {
  it('walks a testimonial from pending to the public wall and back', async () => {
    await submit({ rating: 5, name: 'Priya Raman', company: 'Cobalt Labs' })
    const id = await firstId()

    const pending = await owner.get('/api/testimonials?status=pending').expect(200)
    expect(pending.body.data.items).toHaveLength(1)
    expect(pending.body.data.stats).toMatchObject({ total: 1, pending: 1, approved: 0 })

    const approved = await owner
      .patch(`/api/testimonials/${id}`)
      .send({ status: 'approved' })
      .expect(200)
    expect(approved.body.data.testimonial.status).toBe('approved')
    expect(approved.body.data.stats).toMatchObject({ pending: 0, approved: 1, averageRating: 5 })

    const [approvedRow] = await server.sql('SELECT status, approved_at FROM testimonials WHERE id = $1', [id])
    expect(approvedRow.status).toBe('approved')
    expect(approvedRow.approved_at).toBeInstanceOf(Date)

    const wall = await request(server.app).get('/api/public/wall/northwind').expect(200)
    expect(wall.body.data.testimonials).toHaveLength(1)
    expect(wall.body.data.testimonials[0]).toMatchObject({
      name: 'Priya Raman',
      company: 'Cobalt Labs',
      rating: 5,
    })
    // The wall projection must not leak moderation or ownership metadata.
    expect(wall.body.data.testimonials[0]).not.toHaveProperty('status')
    expect(wall.body.data.testimonials[0]).not.toHaveProperty('businessId')
    expect(wall.body.data.testimonials[0]).not.toHaveProperty('ipHash')

    await owner.patch(`/api/testimonials/${id}`).send({ status: 'rejected' }).expect(200)
    const afterReject = await request(server.app).get('/api/public/wall/northwind').expect(200)
    expect(afterReject.body.data.testimonials).toHaveLength(0)

    const [rejectedRow] = await server.sql('SELECT approved_at FROM testimonials WHERE id = $1', [id])
    expect(rejectedRow.approved_at).toBeNull()

    await owner.patch(`/api/testimonials/${id}`).send({ status: 'pending' }).expect(200)
    const rejectedTab = await owner.get('/api/testimonials?status=rejected').expect(200)
    expect(rejectedTab.body.data.items).toHaveLength(0)
  })

  it('deletes a testimonial', async () => {
    await submit()
    const id = await firstId()
    const removed = await owner.delete(`/api/testimonials/${id}`).expect(200)
    expect(removed.body.data.id).toBe(id)
    expect(removed.body.data.stats.total).toBe(0)
    expect(await server.sql('SELECT 1 FROM testimonials')).toHaveLength(0)
  })

  it('rejects an unknown moderation status', async () => {
    await submit()
    const id = await firstId()
    await owner.patch(`/api/testimonials/${id}`).send({ status: 'published' }).expect(400)
  })

  it('averages only the approved ratings', async () => {
    await submit({ rating: 5, name: 'A' })
    await submit({ rating: 3, name: 'B' })
    await submit({ rating: 4, name: 'C' })

    const list = await owner.get('/api/testimonials?status=all').expect(200)
    // Look the ids up by name so the assertion does not depend on sort order.
    const idsByName = Object.fromEntries(
      list.body.data.items.map((item) => [item.name, item.id]),
    )

    await owner.patch(`/api/testimonials/${idsByName.A}`).send({ status: 'approved' }).expect(200)
    await owner.patch(`/api/testimonials/${idsByName.B}`).send({ status: 'approved' }).expect(200)
    const stats = await owner.get('/api/testimonials?status=all').expect(200)
    // 5 and 3 approved; the pending 4 must not count.
    expect(stats.body.data.stats.averageRating).toBe(4)
    expect(stats.body.data.stats.approved).toBe(2)
    expect(stats.body.data.stats.pending).toBe(1)
  })
})

describe('listing, filtering and sorting', () => {
  beforeEach(async () => {
    // Small gaps keep the age-based ordering unambiguous.
    const gap = () => new Promise((resolve) => setTimeout(resolve, 5))
    await submit({ rating: 2, name: 'Zoe', company: 'Acme', text: 'It was fine but nothing special.' })
    await gap()
    await submit({ rating: 5, name: 'Adam', company: 'Globex', text: 'Outstanding work from start.' })
    await gap()
    await submit({ rating: 4, name: 'Bea', company: 'Initech', text: 'Good experience overall here.' })
  })

  it('filters by status', async () => {
    const pending = await owner.get('/api/testimonials?status=pending').expect(200)
    expect(pending.body.data.items).toHaveLength(3)
    const approved = await owner.get('/api/testimonials?status=approved').expect(200)
    expect(approved.body.data.items).toHaveLength(0)
  })

  it('searches name, company and text', async () => {
    const byName = await owner.get('/api/testimonials?status=all&q=adam').expect(200)
    expect(byName.body.data.items).toHaveLength(1)
    const byCompany = await owner.get('/api/testimonials?status=all&q=globex').expect(200)
    expect(byCompany.body.data.items).toHaveLength(1)
    const byText = await owner.get('/api/testimonials?status=all&q=outstanding').expect(200)
    expect(byText.body.data.items).toHaveLength(1)
    const nothing = await owner.get('/api/testimonials?status=all&q=zzzz').expect(200)
    expect(nothing.body.data.items).toHaveLength(0)
  })

  it('sorts by rating and by age', async () => {
    const byRating = await owner.get('/api/testimonials?status=all&sort=rating').expect(200)
    expect(byRating.body.data.items.map((item) => item.rating)).toEqual([5, 4, 2])

    const oldest = await owner.get('/api/testimonials?status=all&sort=oldest').expect(200)
    expect(oldest.body.data.items[0].name).toBe('Zoe')

    const newest = await owner.get('/api/testimonials?status=all&sort=newest').expect(200)
    expect(newest.body.data.items[0].name).toBe('Bea')
  })

  it('rejects an unknown sort or status value', async () => {
    await owner.get('/api/testimonials?sort=cheapest').expect(400)
    await owner.get('/api/testimonials?status=deleted').expect(400)
  })
})

describe('tenant isolation', () => {
  it('shows each business only its own testimonials', async () => {
    await submit({ name: 'ForNorthwind' }, 'northwind')
    await submit({ name: 'ForFieldnote' }, 'fieldnote')

    const mine = await owner.get('/api/testimonials?status=all').expect(200)
    expect(mine.body.data.items.map((item) => item.name)).toEqual(['ForNorthwind'])

    const theirs = await other.get('/api/testimonials?status=all').expect(200)
    expect(theirs.body.data.items.map((item) => item.name)).toEqual(['ForFieldnote'])
  })

  it('cannot moderate or delete another tenant’s testimonial', async () => {
    await submit()
    const id = await firstId()

    // Reported as 404 rather than 403 so the API does not confirm the row exists.
    await other.patch(`/api/testimonials/${id}`).send({ status: 'approved' }).expect(404)
    await other.delete(`/api/testimonials/${id}`).expect(404)

    const rows = await server.sql('SELECT status FROM testimonials')
    expect(rows[0].status).toBe('pending')
    expect(rows).toHaveLength(1)
  })

  it('keeps each business’s wall separate', async () => {
    await submit({ name: 'ForNorthwind' }, 'northwind')
    const id = await firstId()
    await owner.patch(`/api/testimonials/${id}`).send({ status: 'approved' }).expect(200)

    const otherWall = await request(server.app).get('/api/public/wall/fieldnote').expect(200)
    expect(otherWall.body.data.testimonials).toHaveLength(0)
    expect(otherWall.body.data.business.name).toBe('Fieldnote')
  })

  it('does not let a business slug be claimed twice', async () => {
    const third = request.agent(server.app)
    await third
      .post('/api/auth/signup')
      .send({ email: 'third@example.com', password: VALID_PASSWORD, name: 'Third' })
      .expect(201)
    await third.post('/api/business').send({ name: 'Impostor', slug: 'northwind' }).expect(409)
  })
})

describe('submission limits', () => {
  it('throttles rapid submissions from one client', async () => {
    const limited = await createTestServer({
      rateLimits: {
        auth: { windowMs: 60_000, max: 50 },
        submit: { windowMs: 60_000, max: 2 },
        api: { windowMs: 60_000, max: 500 },
      },
    })
    try {
      const agent = await seedAccount(request, limited.app, {
        email: 'owner@example.com',
        slug: 'limited',
      })
      expect(agent).toBeTruthy()

      await submitTestimonial(limited.app, 'limited', { name: 'One' }).then((r) =>
        expect(r.status).toBe(201),
      )
      await submitTestimonial(limited.app, 'limited', { name: 'Two' }).then((r) =>
        expect(r.status).toBe(201),
      )
      const blocked = await submitTestimonial(limited.app, 'limited', { name: 'Three' })
      expect(blocked.status).toBe(429)
      expect(blocked.body.error.code).toBe('rate_limited')
      expect(await limited.sql('SELECT 1 FROM testimonials')).toHaveLength(2)
    } finally {
      await limited.cleanup()
    }
  })

  it('enforces a per-business daily ceiling', async () => {
    const capped = await createTestServer({ submissionDailyQuota: 2 })
    try {
      await seedAccount(request, capped.app, { email: 'owner@example.com', slug: 'capped' })
      await submitTestimonial(capped.app, 'capped', { name: 'One' }).then((r) =>
        expect(r.status).toBe(201),
      )
      await submitTestimonial(capped.app, 'capped', { name: 'Two' }).then((r) =>
        expect(r.status).toBe(201),
      )
      const blocked = await submitTestimonial(capped.app, 'capped', { name: 'Three' })
      expect(blocked.status).toBe(429)
      expect(await capped.sql('SELECT 1 FROM testimonials')).toHaveLength(2)
    } finally {
      await capped.cleanup()
    }
  })
})
