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

function signup(app, email, name = 'Owner') {
  const agent = request.agent(app)
  return agent
    .post('/api/auth/signup')
    .send({ email, password: VALID_PASSWORD, name })
    .expect(201)
    .then(() => agent)
}

async function account(agent) {
  return (await agent.get('/api/account').expect(200)).body.data
}

async function setupClient(agent, ws, { name = 'Acme', slug = `acme-${Math.random().toString(36).slice(2, 8)}` } = {}) {
  const created = await agent
    .set('x-workspace-id', ws)
    .post('/api/workspace/clients')
    .send({ name, slug })
    .expect(201)
  const client = created.body.data.client
  const projects = await agent.set('x-workspace-id', ws).get('/api/workspace/projects').expect(200)
  const project = projects.body.data.items.find((p) => p.clientId === client.id && p.isDefault)
  return { client, project }
}

function createWidget(agent, ws, projectId, overrides = {}) {
  return agent
    .set('x-workspace-id', ws)
    .post(`/api/projects/projects/${projectId}/widgets`)
    .send({ name: 'Homepage wall', ...overrides })
}

/** Adds an approved testimonial straight into a project (bypasses the form). */
function importTestimonials(agent, ws, projectId, rows) {
  return agent
    .set('x-workspace-id', ws)
    .post(`/api/projects/projects/${projectId}/import`)
    .send({ commit: true, rows })
}

/** Creates an additional member and returns their agent + userId. */
async function addMember(owner, ws, email, role) {
  const member = await signup(server.app, email, role)
  const res = await owner
    .set('x-workspace-id', ws)
    .post('/api/workspace/team')
    .send({ email, role })
    .expect(201)
  return { agent: member, userId: res.body.data.member.userId }
}

describe('saved widgets', () => {
  it('creates a draft widget with a stable public id, then lists and reads it', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const { workspace } = await account(owner)
    const ws = workspace.id
    const { project } = await setupClient(owner, ws)

    const created = await createWidget(owner, ws, project.id, { name: 'Landing carousel', layout: 'carousel' }).expect(201)
    const widget = created.body.data.widget
    expect(widget).toMatchObject({ name: 'Landing carousel', layout: 'carousel', status: 'draft' })
    expect(widget.publicId).toMatch(/^[a-f0-9]{24}$/)

    const list = await owner.set('x-workspace-id', ws).get('/api/projects/widgets').expect(200)
    expect(list.body.data.items).toHaveLength(1)
    expect(list.body.data.items[0]).toMatchObject({
      id: widget.id,
      clientName: 'Acme',
      projectName: project.name,
      status: 'draft',
    })

    const single = await owner.set('x-workspace-id', ws).get(`/api/projects/widgets/${widget.id}`).expect(200)
    expect(single.body.data.widget.publicId).toBe(widget.publicId)
  })

  it('partially updates a widget without resetting omitted fields', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const { workspace } = await account(owner)
    const ws = workspace.id
    const { project } = await setupClient(owner, ws)
    const widget = (await createWidget(owner, ws, project.id, { theme: 'dark', accent: '#0ea5e9' }).expect(201)).body.data.widget

    const renamed = await owner
      .set('x-workspace-id', ws)
      .patch(`/api/projects/widgets/${widget.id}`)
      .send({ name: 'Renamed' })
      .expect(200)
    expect(renamed.body.data.widget).toMatchObject({ name: 'Renamed', theme: 'dark', accent: '#0ea5e9' })

    const published = await owner
      .set('x-workspace-id', ws)
      .patch(`/api/projects/widgets/${widget.id}`)
      .send({ status: 'live' })
      .expect(200)
    expect(published.body.data.widget.status).toBe('live')
    expect(published.body.data.widget.name).toBe('Renamed')
  })

  it('duplicates a widget into a fresh draft with a new public id', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const { workspace } = await account(owner)
    const ws = workspace.id
    const { project } = await setupClient(owner, ws)
    const original = (await createWidget(owner, ws, project.id, { name: 'Footer', status: 'live' }).expect(201)).body.data.widget

    const copy = await owner
      .set('x-workspace-id', ws)
      .post(`/api/projects/widgets/${original.id}/duplicate`)
      .send({})
      .expect(201)
    expect(copy.body.data.widget).toMatchObject({ name: 'Footer (copy)', status: 'draft' })
    expect(copy.body.data.widget.publicId).not.toBe(original.publicId)
    expect(copy.body.data.widget.id).not.toBe(original.id)
  })

  it('archives a widget and removes it from the live feed', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const { workspace } = await account(owner)
    const ws = workspace.id
    const { project } = await setupClient(owner, ws)
    const widget = (await createWidget(owner, ws, project.id, { status: 'live' }).expect(201)).body.data.widget

    await request(server.app).get(`/api/public/widgets/${widget.publicId}`).expect(200)
    await owner.set('x-workspace-id', ws).patch(`/api/projects/widgets/${widget.id}`).send({ status: 'archived' }).expect(200)
    await request(server.app).get(`/api/public/widgets/${widget.publicId}`).expect(404)
  })
})

describe('saved widget public feed', () => {
  it('serves only approved testimonials for a live widget, with rating/tag filters', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const { workspace } = await account(owner)
    const ws = workspace.id
    const { project } = await setupClient(owner, ws)
    await importTestimonials(owner, ws, project.id, [
      { name: 'Five Star', text: 'Absolutely brilliant work, would hire again.', rating: '5', status: 'approved' },
      { name: 'Three Star', text: 'It was okay, nothing special overall.', rating: '3', status: 'approved' },
      { name: 'Pending One', text: 'Still waiting for approval on this one.', rating: '5', status: 'pending' },
    ])

    const widget = (
      await createWidget(owner, ws, project.id, { status: 'live', minRating: 4, max: 10 }).expect(201)
    ).body.data.widget

    const feed = await request(server.app).get(`/api/public/widgets/${widget.publicId}`).expect(200)
    expect(feed.body.data.widget).toMatchObject({ layout: 'grid', theme: 'light' })
    const names = feed.body.data.testimonials.map((t) => t.name)
    expect(names).toContain('Five Star')
    expect(names).not.toContain('Three Star') // below the rating floor
    expect(names).not.toContain('Pending One') // never public
    // The public projection never leaks moderation metadata.
    expect(feed.body.data.testimonials[0]).not.toHaveProperty('status')
  })

  it('404s an unknown or malformed public id', async () => {
    await request(server.app).get('/api/public/widgets/doesnotexist').expect(404)
    await request(server.app).get('/api/public/widgets/not%20a%20valid%20id!').expect(404)
  })

  it('keeps the legacy slug feed working alongside saved widgets', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const { workspace } = await account(owner)
    const ws = workspace.id
    const { project } = await setupClient(owner, ws, { slug: 'legacy-co' })
    await importTestimonials(owner, ws, project.id, [
      { name: 'Legacy Fan', text: 'The legacy embed still works perfectly.', rating: '5', status: 'approved' },
    ])
    const legacy = await request(server.app).get('/api/public/widget/legacy-co').expect(200)
    expect(legacy.body.data.business.slug).toBe('legacy-co')
    expect(legacy.body.data.testimonials.map((t) => t.name)).toContain('Legacy Fan')
  })
})

describe('saved widget isolation', () => {
  it('hides another workspace\'s widgets from list, read, edit, duplicate and delete', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const aliceWs = (await account(alice)).workspace.id
    const { project } = await setupClient(alice, aliceWs, { name: 'Alice Co', slug: 'alice-co' })
    const widget = (await createWidget(alice, aliceWs, project.id).expect(201)).body.data.widget

    const bob = await signup(server.app, 'bob@example.com', 'Bob')
    const bobWs = (await account(bob)).workspace.id

    const list = await bob.set('x-workspace-id', bobWs).get('/api/projects/widgets').expect(200)
    expect(list.body.data.items).toHaveLength(0)

    await bob.set('x-workspace-id', bobWs).get(`/api/projects/widgets/${widget.id}`).expect(404)
    await bob.set('x-workspace-id', bobWs).patch(`/api/projects/widgets/${widget.id}`).send({ name: 'pwned' }).expect(404)
    await bob.set('x-workspace-id', bobWs).post(`/api/projects/widgets/${widget.id}/duplicate`).send({}).expect(404)
    await bob.set('x-workspace-id', bobWs).delete(`/api/projects/widgets/${widget.id}`).expect(404)
  })

  it('requires authentication for the management endpoints', async () => {
    await request(server.app).get('/api/projects/widgets').expect(401)
    await request(server.app).patch('/api/projects/widgets/00000000-0000-0000-0000-000000000000').send({}).expect(401)
  })
})

describe('widget roles', () => {
  it('lets a manager manage widgets only for assigned clients', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const ws = (await account(owner)).workspace.id
    const a = await setupClient(owner, ws, { name: 'Client A', slug: 'client-a' })
    const b = await setupClient(owner, ws, { name: 'Client B', slug: 'client-b' })

    const { agent: manager, userId } = await addMember(owner, ws, 'manager@example.com', 'manager')
    await owner
      .set('x-workspace-id', ws)
      .put(`/api/workspace/team/${userId}/clients`)
      .send({ clientIds: [a.client.id] })
      .expect(200)

    // Assigned client: allowed.
    await createWidget(manager, ws, a.project.id).expect(201)
    const widget = (await manager.set('x-workspace-id', ws).get('/api/projects/widgets').expect(200)).body.data.items[0]
    await manager.set('x-workspace-id', ws).patch(`/api/projects/widgets/${widget.id}`).send({ status: 'live' }).expect(200)

    // Unassigned client: 404.
    await createWidget(manager, ws, b.project.id).expect(404)
  })

  it('stops a viewer from creating or editing widgets', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const ws = (await account(owner)).workspace.id
    const a = await setupClient(owner, ws, { name: 'Client A', slug: 'client-a' })
    const widget = (await createWidget(owner, ws, a.project.id).expect(201)).body.data.widget

    const { agent: viewer, userId } = await addMember(owner, ws, 'viewer@example.com', 'viewer')
    await owner.set('x-workspace-id', ws).put(`/api/workspace/team/${userId}/clients`).send({ clientIds: [a.client.id] }).expect(200)

    // A viewer can read the list but not write.
    await viewer.set('x-workspace-id', ws).get('/api/projects/widgets').expect(200)
    await createWidget(viewer, ws, a.project.id).expect(404)
    await viewer.set('x-workspace-id', ws).patch(`/api/projects/widgets/${widget.id}`).send({ name: 'nope' }).expect(403)
  })
})

describe('workspace summaries', () => {
  it('returns per-client and per-project counts without join multiplication', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const ws = (await account(owner)).workspace.id
    const { client, project } = await setupClient(owner, ws, { name: 'Counted Co', slug: 'counted-co' })

    await importTestimonials(owner, ws, project.id, [
      { name: 'A', text: 'Approved testimonial number one here.', rating: '5', status: 'approved' },
      { name: 'B', text: 'Approved testimonial number two here.', rating: '4', status: 'approved' },
      { name: 'C', text: 'Pending testimonial number three here.', rating: '3', status: 'pending' },
    ])
    // Two widgets on the same project must not multiply the testimonial counts.
    await createWidget(owner, ws, project.id, { name: 'One', status: 'live' }).expect(201)
    await createWidget(owner, ws, project.id, { name: 'Two', status: 'draft' }).expect(201)

    const clients = await owner.set('x-workspace-id', ws).get('/api/workspace/clients/summary').expect(200)
    const clientRow = clients.body.data.items.find((row) => row.id === client.id)
    expect(clientRow).toMatchObject({
      testimonials: 3,
      pending: 1,
      approved: 2,
      projects: 1,
      widgets: 2,
      liveWidgets: 1,
    })

    const projects = await owner.set('x-workspace-id', ws).get('/api/workspace/projects/summary').expect(200)
    const projectRow = projects.body.data.items.find((row) => row.id === project.id)
    expect(projectRow).toMatchObject({ testimonials: 3, pending: 1, approved: 2, widgets: 2, liveWidgets: 1 })
  })
})

describe('moderation roles', () => {
  async function pendingFor(owner, ws, projectId, clientId) {
    await importTestimonials(owner, ws, projectId, [
      { name: 'Pending Pat', text: 'Please review this pending testimonial.', rating: '4', status: 'pending' },
    ])
    const list = await owner
      .set('x-workspace-id', ws)
      .get(`/api/testimonials?status=pending&clientId=${clientId}&projectId=${projectId}`)
      .expect(200)
    return list.body.data.items[0]
  }

  it('lets a manager moderate a testimonial on an assigned client (not just the owner)', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const ws = (await account(owner)).workspace.id
    const a = await setupClient(owner, ws, { name: 'Client A', slug: 'client-a' })
    const pending = await pendingFor(owner, ws, a.project.id, a.client.id)

    const { agent: manager, userId } = await addMember(owner, ws, 'manager@example.com', 'manager')
    await owner.set('x-workspace-id', ws).put(`/api/workspace/team/${userId}/clients`).send({ clientIds: [a.client.id] }).expect(200)

    // The manager sees pending rows (not only approved) and can approve them.
    const inbox = await manager.set('x-workspace-id', ws).get(`/api/testimonials?status=pending&clientId=${a.client.id}`).expect(200)
    expect(inbox.body.data.items.map((t) => t.id)).toContain(pending.id)
    const approved = await manager
      .set('x-workspace-id', ws)
      .patch(`/api/testimonials/${pending.id}?clientId=${a.client.id}`)
      .send({ status: 'approved' })
      .expect(200)
    expect(approved.body.data.testimonial.status).toBe('approved')
  })

  it('blocks a manager from moderating an unassigned client', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const ws = (await account(owner)).workspace.id
    const a = await setupClient(owner, ws, { name: 'Client A', slug: 'client-a' })
    const b = await setupClient(owner, ws, { name: 'Client B', slug: 'client-b' })
    const pendingB = await pendingFor(owner, ws, b.project.id, b.client.id)

    const { agent: manager, userId } = await addMember(owner, ws, 'manager@example.com', 'manager')
    await owner.set('x-workspace-id', ws).put(`/api/workspace/team/${userId}/clients`).send({ clientIds: [a.client.id] }).expect(200)

    await manager.set('x-workspace-id', ws).get(`/api/testimonials?clientId=${b.client.id}`).expect(404)
    await manager.set('x-workspace-id', ws).patch(`/api/testimonials/${pendingB.id}`).send({ status: 'approved' }).expect(404)
  })

  it('lets a viewer read but not moderate, and lets an admin moderate', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const ws = (await account(owner)).workspace.id
    const a = await setupClient(owner, ws, { name: 'Client A', slug: 'client-a' })
    const pending = await pendingFor(owner, ws, a.project.id, a.client.id)

    const { agent: viewer, userId: viewerId } = await addMember(owner, ws, 'viewer@example.com', 'viewer')
    await owner.set('x-workspace-id', ws).put(`/api/workspace/team/${viewerId}/clients`).send({ clientIds: [a.client.id] }).expect(200)
    await viewer.set('x-workspace-id', ws).get(`/api/testimonials?clientId=${a.client.id}`).expect(200)
    await viewer.set('x-workspace-id', ws).patch(`/api/testimonials/${pending.id}`).send({ status: 'approved' }).expect(404)

    // An admin who is not the business owner can still moderate.
    const { agent: admin } = await addMember(owner, ws, 'admin@example.com', 'admin')
    const ok = await admin
      .set('x-workspace-id', ws)
      .patch(`/api/testimonials/${pending.id}?clientId=${a.client.id}`)
      .send({ status: 'approved' })
      .expect(200)
    expect(ok.body.data.testimonial.status).toBe('approved')
  })

  it('returns 404 when another workspace tries to moderate the row', async () => {
    const owner = await signup(server.app, 'owner@example.com')
    const ws = (await account(owner)).workspace.id
    const a = await setupClient(owner, ws, { name: 'Client A', slug: 'client-a' })
    const pending = await pendingFor(owner, ws, a.project.id, a.client.id)

    const intruder = await signup(server.app, 'intruder@example.com', 'Intruder')
    const intruderWs = (await account(intruder)).workspace.id
    await intruder.set('x-workspace-id', intruderWs).patch(`/api/testimonials/${pending.id}`).send({ status: 'rejected' }).expect(404)
    await intruder.set('x-workspace-id', intruderWs).delete(`/api/testimonials/${pending.id}`).expect(404)
  })
})
