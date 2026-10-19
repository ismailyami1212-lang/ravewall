import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { computeFunnel, formatFunnel, runReport } from '../../scripts/activation-report.mjs'
import { createTestDb } from './helpers/server.js'
import { runMigrations } from '../server/db.js'

/**
 * The activation report is pure derived SQL, so these tests exercise it against
 * a real PostgreSQL (PGlite) with the real migrations — no mocked database and
 * no second implementation of the query.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-19T12:00:00.000Z')

const silentLogger: Console = {
  ...console,
  error() {},
  warn() {},
  log() {},
  info() {},
}

let db: any
let userSeq = 0

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)

beforeAll(async () => {
  db = await createTestDb()
  await runMigrations(db, { logger: silentLogger })
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  userSeq = 0
  await db.exec(`
    TRUNCATE TABLE
      users,
      workspaces,
      workspace_members,
      workspace_member_clients,
      businesses,
      projects,
      testimonials,
      sessions,
      rate_limit_hits,
      custom_questions,
      tags,
      testimonial_tags,
      widget_configs
    CASCADE
  `)
})

async function query(text: string, params: unknown[] = []): Promise<any[]> {
  const result = await db.query(text, params)
  return result.rows
}

async function createUser() {
  const rows = await query(
    `INSERT INTO users (email, name, password_hash, password_salt)
     VALUES ($1, 'Owner', 'test-hash', 'test-salt')
     RETURNING id`,
    [`owner-${++userSeq}@example.com`],
  )
  return rows[0].id as string
}

async function createWorkspace(name: string, createdAt: Date) {
  const rows = await query(
    `INSERT INTO workspaces (name, created_at)
     VALUES ($1, $2)
     RETURNING id`,
    [name, createdAt.toISOString()],
  )
  return rows[0].id as string
}

async function createClient(workspaceId: string, ownerId: string, slug: string) {
  const rows = await query(
    `INSERT INTO businesses (owner_user_id, workspace_id, name, slug)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [ownerId, workspaceId, slug, slug],
  )
  return rows[0].id as string
}

async function createProject(workspaceId: string, clientId: string, slug: string) {
  const rows = await query(
    `INSERT INTO projects (workspace_id, business_id, name, slug)
     VALUES ($1, $2, $3, $3)
     RETURNING id`,
    [workspaceId, clientId, slug],
  )
  return rows[0].id as string
}

async function createTestimonial(businessId: string, projectId: string, status: string) {
  const rows = await query(
    `INSERT INTO testimonials (business_id, project_id, author_name, rating, content, status)
     VALUES ($1, $2, 'Customer', 5, 'A genuinely useful product with fast support.', $3)
     RETURNING id`,
    [businessId, projectId, status],
  )
  return rows[0].id as string
}

async function createWidget(projectId: string, status: string) {
  const rows = await query(
    `INSERT INTO widget_configs (project_id, name, status)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [projectId, `Widget ${status}`, status],
  )
  return rows[0].id as string
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 22)
}

interface WorkspaceSeed {
  name: string
  createdAt?: Date
  clients?: number
  projectsPerClient?: number
  testimonialStatuses?: string[]
  widgetStatuses?: string[]
}

/**
 * Seeds one workspace plus whatever activity the test asks for. A workspace
 * automatically gets one client when testimonials or widgets are requested,
 * because both live under a client/project in the real schema.
 */
async function seedWorkspace(seed: WorkspaceSeed) {
  const base = slugify(seed.name)
  const needsClient =
    (seed.testimonialStatuses?.length ?? 0) > 0 || (seed.widgetStatuses?.length ?? 0) > 0
  const clientCount = seed.clients ?? (needsClient ? 1 : 0)
  const projectsPerClient = seed.projectsPerClient ?? 1

  const ownerId = await createUser()
  const workspaceId = await createWorkspace(seed.name, seed.createdAt ?? NOW)

  const projects: Array<{ projectId: string; clientId: string }> = []

  for (let clientIndex = 0; clientIndex < clientCount; clientIndex += 1) {
    const clientId = await createClient(workspaceId, ownerId, `${base}-c${clientIndex}`)
    for (let projectIndex = 0; projectIndex < projectsPerClient; projectIndex += 1) {
      const projectId = await createProject(
        workspaceId,
        clientId,
        `${base}-p${clientIndex}-${projectIndex}`,
      )
      projects.push({ projectId, clientId })
    }
  }

  for (const [index, status] of (seed.testimonialStatuses ?? []).entries()) {
    const target = projects[index % projects.length]
    await createTestimonial(target.clientId, target.projectId, status)
  }

  for (const [index, status] of (seed.widgetStatuses ?? []).entries()) {
    const target = projects[index % projects.length]
    await createWidget(target.projectId, status)
  }

  return { workspaceId, ownerId, projects }
}

const ZERO_TOTALS = {
  newWorkspaces: 0,
  withClient: 0,
  withTestimonial: 0,
  withApprovedTestimonial: 0,
  withLiveWidget: 0,
}

const ZERO_CONVERSION = {
  workspaceToClient: 0,
  clientToTestimonial: 0,
  testimonialToApproval: 0,
  approvalToLiveWidget: 0,
  overallActivation: 0,
}

describe('activation funnel (derived)', () => {
  it('empty cohort returns zero counts and 0.0% conversions without crashing', async () => {
    const funnel = await computeFunnel(db, 30, { now: NOW })

    expect(funnel.range.days).toBe(30)
    expect(funnel.totals).toEqual(ZERO_TOTALS)
    expect(funnel.conversion).toEqual(ZERO_CONVERSION)

    const text = formatFunnel(funnel)
    expect(text).toContain('Workspaces created   : 0')
    expect(text).toContain('0.0%')
    expect(text).not.toMatch(/NaN|Infinity/)
  })

  it('applies the 7-day and 30-day boundaries to workspaces.created_at', async () => {
    await seedWorkspace({ name: 'ws-inside-7d', createdAt: daysAgo(1) })
    await seedWorkspace({ name: 'ws-between-7-and-30d', createdAt: daysAgo(8) })
    await seedWorkspace({ name: 'ws-outside-30d', createdAt: daysAgo(31) })

    const d7 = await computeFunnel(db, 7, { now: NOW })
    expect(d7.totals.newWorkspaces).toBe(1)

    const d30 = await computeFunnel(db, 30, { now: NOW })
    expect(d30.totals.newWorkspaces).toBe(2)

    const report = await runReport(db, { now: NOW })
    expect(report.d7.range.days).toBe(7)
    expect(report.d30.range.days).toBe(30)
    expect(report.d7.totals.newWorkspaces).toBe(1)
    expect(report.d30.totals.newWorkspaces).toBe(2)
  })

  it('milestone 1: counts a workspace created in the cohort once', async () => {
    await seedWorkspace({ name: 'ws-one', createdAt: daysAgo(2) })
    await seedWorkspace({ name: 'ws-two', createdAt: daysAgo(3) })
    await seedWorkspace({ name: 'ws-three', createdAt: daysAgo(4) })

    const funnel = await computeFunnel(db, 7, { now: NOW })

    expect(funnel.totals.newWorkspaces).toBe(3)
    expect(funnel.totals.withClient).toBe(0)
    expect(funnel.totals.withTestimonial).toBe(0)
    expect(funnel.totals.withApprovedTestimonial).toBe(0)
    expect(funnel.totals.withLiveWidget).toBe(0)
  })

  it('milestone 2: a workspace with many clients is counted once', async () => {
    await seedWorkspace({ name: 'ws-single-client', clients: 1 })
    await seedWorkspace({ name: 'ws-many-clients', clients: 3 })

    const funnel = await computeFunnel(db, 7, { now: NOW })

    expect(funnel.totals.newWorkspaces).toBe(2)
    expect(funnel.totals.withClient).toBe(2)
    expect(funnel.conversion.workspaceToClient).toBe(100)
  })

  it('milestone 3: a workspace with many testimonials is counted once', async () => {
    await seedWorkspace({
      name: 'ws-single-testimonial',
      testimonialStatuses: ['pending'],
    })
    await seedWorkspace({
      name: 'ws-many-testimonials',
      clients: 2,
      projectsPerClient: 2,
      testimonialStatuses: ['pending', 'approved', 'rejected', 'pending'],
    })

    const funnel = await computeFunnel(db, 7, { now: NOW })

    expect(funnel.totals.newWorkspaces).toBe(2)
    expect(funnel.totals.withTestimonial).toBe(2)
    expect(funnel.totals.withApprovedTestimonial).toBe(1)
  })

  it('milestone 4: only approved testimonials satisfy the approval milestone', async () => {
    await seedWorkspace({
      name: 'ws-pending-only',
      testimonialStatuses: ['pending', 'pending'],
    })
    await seedWorkspace({
      name: 'ws-approved',
      testimonialStatuses: ['approved', 'pending'],
    })

    const funnel = await computeFunnel(db, 7, { now: NOW })

    expect(funnel.totals.withTestimonial).toBe(2)
    expect(funnel.totals.withApprovedTestimonial).toBe(1)
    expect(funnel.conversion.testimonialToApproval).toBe(50)
  })

  it('milestone 5: draft and archived widgets do not count, only live does', async () => {
    await seedWorkspace({ name: 'ws-draft-widget', widgetStatuses: ['draft'] })
    await seedWorkspace({ name: 'ws-archived-widget', widgetStatuses: ['archived'] })
    await seedWorkspace({
      name: 'ws-live-widget',
      widgetStatuses: ['draft', 'live', 'archived'],
    })

    const funnel = await computeFunnel(db, 7, { now: NOW })

    expect(funnel.totals.newWorkspaces).toBe(3)
    expect(funnel.totals.withLiveWidget).toBe(1)
    expect(funnel.conversion.overallActivation).toBe(33.3)
  })

  it('keeps workspaces isolated from activity in another workspace', async () => {
    // A is in the 7-day cohort but has no activity at all.
    await seedWorkspace({ name: 'ws-a', createdAt: daysAgo(1) })

    // B is outside the 7-day cohort (inside 30) and is fully activated. None of
    // B's clients, testimonials or widgets may leak into A's milestones.
    await seedWorkspace({
      name: 'ws-b',
      createdAt: daysAgo(20),
      clients: 2,
      testimonialStatuses: ['approved', 'approved'],
      widgetStatuses: ['live'],
    })

    const d7 = await computeFunnel(db, 7, { now: NOW })
    expect(d7.totals).toEqual({ ...ZERO_TOTALS, newWorkspaces: 1 })

    const d30 = await computeFunnel(db, 30, { now: NOW })
    expect(d30.totals).toEqual({
      newWorkspaces: 2,
      withClient: 1,
      withTestimonial: 1,
      withApprovedTestimonial: 1,
      withLiveWidget: 1,
    })
  })

  it('does not count invited team members as additional workspaces', async () => {
    const { workspaceId } = await seedWorkspace({ name: 'ws-team' })

    for (let index = 0; index < 3; index += 1) {
      const userId = await createUser()
      await query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'viewer', 'invited')`,
        [workspaceId, userId],
      )
    }

    const funnel = await computeFunnel(db, 7, { now: NOW })

    expect(funnel.totals.newWorkspaces).toBe(1)
    expect(funnel.totals.withClient).toBe(0)
  })
})
