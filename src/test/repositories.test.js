/**
 * Repository-level tests.
 *
 * These exercise the data layer directly against real Postgres, so they cover
 * behaviour the HTTP tests cannot reach: constraint mapping, tenant scoping at
 * the SQL level, the sliding-window limiter and the aggregate queries.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../server/errors.js'
import { userActor } from '../server/policies.js'
import { PostgresRateLimiter, SlidingWindowLimiter } from '../server/rateLimit.js'
import {
  businessStats,
  countSubmissionsSince,
  createBusiness,
  createTestimonial,
  createUser,
  deleteTestimonial,
  getBusinessByOwner,
  getBusinessBySlug,
  isSlugTaken,
  listTestimonials,
  listWall,
  setTestimonialStatus,
  updateBusiness,
} from '../server/repositories.js'
import { createTestDb } from './helpers/server.js'
import { runMigrations } from '../server/db.js'
import { createProject } from '../server/workspaces.js'

const silent = { log() {}, error() {}, warn() {} }

let db
let alice
let bob
let aliceBusiness
let bobBusiness
const projectsByBusiness = new Map()

async function makeUser(email, name) {
  return createUser(db, {
    email,
    name,
    passwordHash: 'hash',
    passwordSalt: 'salt',
  })
}

beforeEach(async () => {
  db = await createTestDb()
  await runMigrations(db, { logger: silent })

  alice = await makeUser('alice@example.com', 'Alice')
  bob = await makeUser('bob@example.com', 'Bob')
  aliceBusiness = await createBusiness(db, alice.id, {
    name: 'Alice Co',
    slug: 'alice-co',
    accentColor: '#15803d',
  })
  bobBusiness = await createBusiness(db, bob.id, {
    name: 'Bob Co',
    slug: 'bob-co',
    accentColor: '#0ea5e9',
  })
  const aliceWs = (await db.query('SELECT workspace_id FROM businesses WHERE id = $1', [aliceBusiness.id])).rows[0].workspace_id
  const bobWs = (await db.query('SELECT workspace_id FROM businesses WHERE id = $1', [bobBusiness.id])).rows[0].workspace_id
  const ap = await createProject(db, { workspaceId: aliceWs, clientId: aliceBusiness.id, name: 'Main', slug: 'alice-main' })
  const bp = await createProject(db, { workspaceId: bobWs, clientId: bobBusiness.id, name: 'Main', slug: 'bob-main' })
  projectsByBusiness.set(aliceBusiness.id, ap.id)
  projectsByBusiness.set(bobBusiness.id, bp.id)
})

afterEach(async () => {
  await db.close()
})

const actor = (user) => userActor(user)

async function addTestimonial(business, overrides = {}) {
  return createTestimonial(db, business, {
    rating: 5,
    name: 'Customer',
    company: 'Acme',
    text: 'A perfectly reasonable testimonial body.',
    ...overrides,
  }, { projectId: projectsByBusiness.get(business.id) })
}

describe('users', () => {
  it('normalises the email and rejects duplicates', async () => {
    const user = await makeUser('  Mixed@Example.COM ', 'Mixed')
    expect(user.email).toBe('mixed@example.com')

    const error = await makeUser('mixed@example.com', 'Again').catch((thrown) => thrown)
    expect(error).toBeInstanceOf(AppError)
    expect(error.status).toBe(409)
    expect(error.fields.email).toBeDefined()
  })
})

describe('businesses', () => {
  it('allows multiple clients per account (the old single-business limit is gone)', async () => {
    const second = await createBusiness(db, alice.id, {
      name: 'Second',
      slug: 'alice-second',
      accentColor: '#15803d',
    })
    expect(second.id).toBeDefined()
    expect(second.slug).toBe('alice-second')
  })

  it('rejects a duplicate slug at the database level', async () => {
    const error = await createBusiness(db, alice.id, {
      name: 'Clash',
      slug: 'bob-co',
      accentColor: '#15803d',
    }).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(AppError)
    expect(error.fields.slug).toBeDefined()
  })

  it('looks slugs up case-insensitively and honours the exclusion', async () => {
    expect((await getBusinessBySlug(db, 'ALICE-CO')).id).toBe(aliceBusiness.id)
    expect(await getBusinessBySlug(db, 'nope')).toBeNull()
    expect(await isSlugTaken(db, 'alice-co')).toBe(true)
    expect(await isSlugTaken(db, 'alice-co', aliceBusiness.id)).toBe(false)
  })

  it('refuses to update a business the actor does not own', async () => {
    const error = await updateBusiness(db, actor(bob), aliceBusiness.id, {
      name: 'Hijacked',
    }).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(AppError)
    expect(error.status).toBe(403)
    // Nothing changed.
    expect((await getBusinessByOwner(db, alice.id)).name).toBe('Alice Co')
  })

  it('updates only whitelisted columns', async () => {
    await updateBusiness(db, actor(alice), aliceBusiness.id, {
      name: 'Alice Renamed',
      tagline: 'New tagline',
      // Not patchable: must be ignored rather than passed through to SQL.
      id: '00000000-0000-0000-0000-000000000000',
      ownerId: bob.id,
      createdAt: '1999-01-01T00:00:00.000Z',
    })

    const updated = await getBusinessByOwner(db, alice.id)
    expect(updated.name).toBe('Alice Renamed')
    expect(updated.tagline).toBe('New tagline')
    expect(updated.ownerId).toBe(alice.id)
    expect(updated.id).toBe(aliceBusiness.id)
    expect(updated.createdAt).not.toContain('1999')
  })

  it('maps a slug clash on update to a conflict', async () => {
    const error = await updateBusiness(db, actor(alice), aliceBusiness.id, {
      slug: 'bob-co',
    }).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(AppError)
    expect(error.status).toBe(409)
  })
})

describe('testimonials', () => {
  it('always creates a pending row, regardless of what the caller sends', async () => {
    const created = await addTestimonial(aliceBusiness)
    expect(created.status).toBe('pending')
    expect(created.approvedAt).toBeNull()
    expect(created.source).toBe('link')
  })

  it('scopes the moderation queue to the business', async () => {
    await addTestimonial(aliceBusiness, { name: 'ForAlice' })
    await addTestimonial(bobBusiness, { name: 'ForBob' })

    const forAlice = await listTestimonials(db, actor(alice), aliceBusiness, {})
    expect(forAlice.map((row) => row.name)).toEqual(['ForAlice'])

    const forBob = await listTestimonials(db, actor(bob), bobBusiness, {})
    expect(forBob.map((row) => row.name)).toEqual(['ForBob'])
  })

  it('filters by status and searches name, company and text', async () => {
    const first = await addTestimonial(aliceBusiness, {
      name: 'Zoe',
      company: 'Acme',
      text: 'It was fine but nothing special.',
      rating: 2,
    })
    await addTestimonial(aliceBusiness, {
      name: 'Adam',
      company: 'Globex',
      text: 'Outstanding work from start to finish.',
      rating: 5,
    })
    await setTestimonialStatus(db, actor(alice), first.id, 'approved')

    const approved = await listTestimonials(db, actor(alice), aliceBusiness, { status: 'approved' })
    expect(approved.map((row) => row.name)).toEqual(['Zoe'])

    const byCompany = await listTestimonials(db, actor(alice), aliceBusiness, { q: 'globex' })
    expect(byCompany.map((row) => row.name)).toEqual(['Adam'])

    const byText = await listTestimonials(db, actor(alice), aliceBusiness, { q: 'OUTSTANDING' })
    expect(byText.map((row) => row.name)).toEqual(['Adam'])

    const byName = await listTestimonials(db, actor(alice), aliceBusiness, { q: 'zoe' })
    expect(byName.map((row) => row.name)).toEqual(['Zoe'])
  })

  it('treats search metacharacters as literal text', async () => {
    await addTestimonial(aliceBusiness, { name: 'Percent', text: '100% satisfied with everything.' })
    // A bare '%' must not behave like a wildcard that matches every row.
    const rows = await listTestimonials(db, actor(alice), aliceBusiness, { q: '100%' })
    expect(rows).toHaveLength(1)
    const noMatch = await listTestimonials(db, actor(alice), aliceBusiness, { q: '%' })
    expect(noMatch).toHaveLength(1)
  })

  it('sorts by age and by rating', async () => {
    const first = await addTestimonial(aliceBusiness, { name: 'First', rating: 2 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await addTestimonial(aliceBusiness, { name: 'Second', rating: 5 })

    expect(
      (await listTestimonials(db, actor(alice), aliceBusiness, { sort: 'oldest' })).map((r) => r.name),
    ).toEqual(['First', 'Second'])
    expect(
      (await listTestimonials(db, actor(alice), aliceBusiness, { sort: 'newest' })).map((r) => r.name),
    ).toEqual(['Second', 'First'])
    expect(
      (await listTestimonials(db, actor(alice), aliceBusiness, { sort: 'rating' })).map((r) => r.rating),
    ).toEqual([5, 2])

    expect(first.status).toBe('pending')
  })

  it('sets and clears approved_at with the status', async () => {
    const created = await addTestimonial(aliceBusiness)

    const approved = await setTestimonialStatus(db, actor(alice), created.id, 'approved')
    expect(approved.status).toBe('approved')
    expect(approved.approvedAt).toBeTruthy()

    const rejected = await setTestimonialStatus(db, actor(alice), created.id, 'rejected')
    expect(rejected.status).toBe('rejected')
    expect(rejected.approvedAt).toBeNull()
  })

  it('hides another tenant’s testimonial behind a 404', async () => {
    const created = await addTestimonial(aliceBusiness)

    const approve = await setTestimonialStatus(db, actor(bob), created.id, 'approved').catch(
      (thrown) => thrown,
    )
    expect(approve).toBeInstanceOf(AppError)
    expect(approve.status).toBe(404)

    const remove = await deleteTestimonial(db, actor(bob), created.id).catch((thrown) => thrown)
    expect(remove).toBeInstanceOf(AppError)
    expect(remove.status).toBe(404)

    const stillThere = await listTestimonials(db, actor(alice), aliceBusiness, {})
    expect(stillThere).toHaveLength(1)
    expect(stillThere[0].status).toBe('pending')
  })

  it('reports a missing testimonial as 404', async () => {
    const missing = '00000000-0000-0000-0000-000000000000'
    const error = await setTestimonialStatus(db, actor(alice), missing, 'approved').catch(
      (thrown) => thrown,
    )
    expect(error.status).toBe(404)
  })
})

describe('public wall and stats', () => {
  it('returns approved rows only', async () => {
    const approved = await addTestimonial(aliceBusiness, { name: 'Approved', rating: 5 })
    await addTestimonial(aliceBusiness, { name: 'Pending', rating: 5 })
    const rejected = await addTestimonial(aliceBusiness, { name: 'Rejected', rating: 1 })

    await setTestimonialStatus(db, actor(alice), approved.id, 'approved')
    await setTestimonialStatus(db, actor(alice), rejected.id, 'rejected')

    const wall = await listWall(db, aliceBusiness)
    expect(wall.map((row) => row.name)).toEqual(['Approved'])
  })

  it('never leaks a pending or rejected row through the wall', async () => {
    await addTestimonial(aliceBusiness, { name: 'Pending' })
    const rejected = await addTestimonial(aliceBusiness, { name: 'Rejected' })
    await setTestimonialStatus(db, actor(alice), rejected.id, 'rejected')

    expect(await listWall(db, aliceBusiness)).toHaveLength(0)
  })

  it('does not mix businesses', async () => {
    const mine = await addTestimonial(aliceBusiness, { name: 'Mine' })
    const theirs = await addTestimonial(bobBusiness, { name: 'Theirs' })
    await setTestimonialStatus(db, actor(alice), mine.id, 'approved')
    await setTestimonialStatus(db, actor(bob), theirs.id, 'approved')

    expect((await listWall(db, aliceBusiness)).map((r) => r.name)).toEqual(['Mine'])
    expect((await listWall(db, bobBusiness)).map((r) => r.name)).toEqual(['Theirs'])
  })

  it('averages approved ratings only', async () => {
    const a = await addTestimonial(aliceBusiness, { rating: 5 })
    const b = await addTestimonial(aliceBusiness, { rating: 3 })
    await addTestimonial(aliceBusiness, { rating: 1 }) // stays pending
    const d = await addTestimonial(aliceBusiness, { rating: 2 })

    await setTestimonialStatus(db, actor(alice), a.id, 'approved')
    await setTestimonialStatus(db, actor(alice), b.id, 'approved')
    await setTestimonialStatus(db, actor(alice), d.id, 'rejected')

    const stats = await businessStats(db, aliceBusiness.id)
    expect(stats).toMatchObject({ total: 4, pending: 1, approved: 2, rejected: 1 })
    expect(stats.averageRating).toBe(4)
    expect(stats.lastSubmissionAt).toMatch(/^\d{4}-/)
  })

  it('reports zeros for a business with no testimonials', async () => {
    expect(await businessStats(db, aliceBusiness.id)).toEqual({
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      averageRating: 0,
      lastSubmissionAt: null,
    })
  })

  it('counts submissions inside the window', async () => {
    await addTestimonial(aliceBusiness)
    await addTestimonial(aliceBusiness)

    expect(await countSubmissionsSince(db, aliceBusiness.id, new Date(Date.now() - 60_000))).toBe(2)
    expect(await countSubmissionsSince(db, aliceBusiness.id, new Date(Date.now() + 60_000))).toBe(0)
    expect(await countSubmissionsSince(db, bobBusiness.id, new Date(0))).toBe(0)
  })
})

describe('PostgresRateLimiter', () => {
  it('allows up to the limit and then blocks with a retry hint', async () => {
    const limiter = new PostgresRateLimiter({
      db,
      bucket: 'test',
      windowMs: 60_000,
      max: 3,
      logger: silent,
    })

    expect((await limiter.hit('client')).allowed).toBe(true)
    expect((await limiter.hit('client')).allowed).toBe(true)
    const third = await limiter.hit('client')
    expect(third.allowed).toBe(true)
    expect(third.remaining).toBe(0)

    const blocked = await limiter.hit('client')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(60_000)
  })

  it('keeps buckets and keys independent', async () => {
    const first = new PostgresRateLimiter({ db, bucket: 'a', windowMs: 60_000, max: 1, logger: silent })
    const second = new PostgresRateLimiter({ db, bucket: 'b', windowMs: 60_000, max: 1, logger: silent })

    expect((await first.hit('same')).allowed).toBe(true)
    expect((await second.hit('same')).allowed).toBe(true)
    expect((await first.hit('same')).allowed).toBe(false)
    expect((await first.hit('other')).allowed).toBe(true)
  })

  it('expires hits once the window has passed', async () => {
    // A realistic window rather than a few milliseconds: the limiter's clock is
    // Postgres `now()`, so an overloaded test machine must not be able to push
    // the second hit outside the window and fail this for the wrong reason.
    const limiter = new PostgresRateLimiter({
      db,
      bucket: 'short',
      windowMs: 800,
      max: 1,
      logger: silent,
    })
    expect((await limiter.hit('client')).allowed).toBe(true)
    expect((await limiter.hit('client')).allowed).toBe(false)

    // Poll instead of sleeping a fixed amount: the assertion is "the window
    // expires", not "the machine is fast".
    const deadline = Date.now() + 5000
    let allowed = false
    while (!allowed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      allowed = (await limiter.hit('client')).allowed
    }
    expect(allowed).toBe(true)
  })

  it('prunes stale counters', async () => {
    const limiter = new PostgresRateLimiter({
      db,
      bucket: 'prune',
      windowMs: 60_000,
      max: 5,
      logger: silent,
    })
    await limiter.hit('client')
    expect(await limiter.prune(60 * 60 * 1000)).toBe(0)
    expect(await limiter.prune(0)).toBe(1)
    expect((await db.query('SELECT 1 FROM rate_limit_hits')).rows).toHaveLength(0)
  })

  it('fails open when the database is unavailable', async () => {
    const warnings = []
    const broken = new PostgresRateLimiter({
      db: {
        query() {
          return Promise.reject(new Error('connection refused'))
        },
      },
      bucket: 'broken',
      windowMs: 60_000,
      max: 1,
      logger: { warn: (...args) => warnings.push(args), error() {}, log() {} },
    })

    const result = await broken.hit('client')
    expect(result.allowed).toBe(true)
    expect(warnings).toHaveLength(1)
    // The limiter must not put the connection string or a stack into the log.
    expect(JSON.stringify(warnings)).not.toMatch(/postgres:\/\//)
  })

  it('still enforces the in-memory limiter for the general API bucket', () => {
    const limiter = new SlidingWindowLimiter({ windowMs: 1000, max: 2 })
    expect(limiter.hit('a', 0).allowed).toBe(true)
    expect(limiter.hit('a', 1).allowed).toBe(true)
    expect(limiter.hit('a', 2).allowed).toBe(false)
  })
})
