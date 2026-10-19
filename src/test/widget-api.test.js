import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestServer, seedAccount, submitTestimonial } from './helpers/server.js'

let server
let owner

beforeEach(async () => {
  server = await createTestServer()
  owner = await seedAccount(request, server.app, {
    email: 'mara@example.com',
    name: 'Mara Ellis',
    slug: 'northwind',
    businessName: 'Northwind Studio',
  })
})

afterEach(async () => {
  await server.cleanup()
})

async function submit(overrides = {}) {
  const response = await submitTestimonial(server.app, 'northwind', overrides)
  expect(response.status).toBe(201)
  return response.body.data
}

/** The newest testimonial's id, as the owner sees it. */
async function newestId() {
  const list = await owner.get('/api/testimonials?status=all').expect(200)
  return list.body.data.items[0].id
}

async function moderate(id, status) {
  const response = await owner.patch(`/api/testimonials/${id}`).send({ status }).expect(200)
  return response.body.data
}

describe('public widget endpoint', () => {
  it('returns approved testimonials with public fields and cache headers', async () => {
    await submit({ rating: 5, name: 'Priya', company: 'Cobalt Labs' })
    const pendingId = await newestId()
    await submit({ rating: 4, name: 'Sam', company: 'Acme' })
    await moderate(await newestId(), 'approved')

    const response = await request(server.app).get('/api/public/widget/northwind').expect(200)
    const data = response.body.data
    expect(Array.isArray(data.testimonials)).toBe(true)
    expect(data.testimonials.every((row) => row.status === undefined)).toBe(true)
    expect(data.business.slug).toBe('northwind')
    expect(data.business.accentColor).toBe('#15803d')
    expect(data.stats).toEqual({ count: 1, averageRating: 4 })
    expect(response.headers['cache-control']).toContain('public')

    // Only approved rows made it through.
    const ids = data.testimonials.map((row) => row.id)
    expect(ids).not.toContain(pendingId)
  })

  it('never exposes moderation metadata, owner id or technical fields', async () => {
    await submit()
    await moderate(await newestId(), 'approved')

    const response = await request(server.app).get('/api/public/widget/northwind').expect(200)
    const row = response.body.data.testimonials[0]
    expect(Object.keys(row).sort()).toEqual(
      ['company', 'createdAt', 'id', 'name', 'rating', 'text'].sort(),
    )
    const business = response.body.data.business
    expect(Object.keys(business).sort()).not.toContain('ownerId')
  })

  it('404s for an unknown slug', async () => {
    await request(server.app).get('/api/public/widget/does-not-exist').expect(404)
  })

  it('returns an empty list when nothing is approved', async () => {
    await submit()
    const response = await request(server.app).get('/api/public/widget/northwind').expect(200)
    expect(response.body.data.testimonials).toEqual([])
    expect(response.body.data.stats).toEqual({ count: 0, averageRating: 0 })
  })

  it('reflects rejections immediately (approved, then rejected)', async () => {
    await submit()
    const id = await newestId()
    await moderate(id, 'approved')
    let response = await request(server.app).get('/api/public/widget/northwind').expect(200)
    expect(response.body.data.testimonials).toHaveLength(1)

    await moderate(id, 'rejected')
    response = await request(server.app).get('/api/public/widget/northwind').expect(200)
    expect(response.body.data.testimonials).toHaveLength(0)
  })

  it('keeps long content intact', async () => {
    const long = 'This is a deliberately long testimonial body used to make sure nothing truncates the widget payload. '.repeat(20)
    await submit({ text: long.slice(0, 1000) })
    await moderate(await newestId(), 'approved')
    const response = await request(server.app).get('/api/public/widget/northwind').expect(200)
    expect(response.body.data.testimonials[0].text).toHaveLength(1000)
  })

  it('does not leak another business accent to a widget', async () => {
    await seedAccount(request, server.app, {
      email: 'other@example.com',
      name: 'Other',
      slug: 'fieldnote',
      businessName: 'Fieldnote',
    })
    const response = await request(server.app).get('/api/public/widget/fieldnote').expect(200)
    expect(response.body.data.business.accentColor).toBe('#15803d')
    expect(response.body.data.business.slug).toBe('fieldnote')
    expect(response.body.data.testimonials).toEqual([])
  })
})
