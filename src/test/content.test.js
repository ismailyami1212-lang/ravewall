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
  return agent.post('/api/auth/signup').send({ email, password: VALID_PASSWORD, name }).expect(201).then(() => agent)
}

async function ownerWorkspace(app) {
  const alice = await signup(app, 'alice@example.com', 'Alice')
  const ws = (await alice.get('/api/account').expect(200)).body.data.workspace.id
  // These tests exercise content, not billing, and several need a second
  // client. Put the workspace on Starter so the Free client cap does not
  // obscure the behaviour under test.
  await server.sql("UPDATE workspaces SET plan = 'starter' WHERE id = $1", [ws])
  const client = await alice
    .set('x-workspace-id', ws)
    .post('/api/workspace/clients')
    .send({ name: 'Acme Co' })
    .expect(201)
  const detail = await alice
    .set('x-workspace-id', ws)
    .get(`/api/workspace/clients/${client.body.data.client.id}`)
    .expect(200)
  return { alice, ws, client: client.body.data.client, project: detail.body.data.projects.find((p) => p.isDefault) }
}

describe('tags', () => {
  it('creates, lists and deletes tags', async () => {
    const { alice, ws } = await ownerWorkspace(server.app)
    const created = await alice.set('x-workspace-id', ws).post('/api/projects/tags').send({ name: 'Case study' }).expect(201)
    expect(created.body.data.tag.name).toBe('Case study')
    const listed = await alice.set('x-workspace-id', ws).get('/api/projects/tags').expect(200)
    expect(listed.body.data.items).toHaveLength(1)
    await alice.set('x-workspace-id', ws).delete(`/api/projects/tags/${created.body.data.tag.id}`).expect(204)
    const after = await alice.set('x-workspace-id', ws).get('/api/projects/tags').expect(200)
    expect(after.body.data.items).toHaveLength(0)
  })

  it('rejects duplicate tag names', async () => {
    const { alice, ws } = await ownerWorkspace(server.app)
    await alice.set('x-workspace-id', ws).post('/api/projects/tags').send({ name: 'Same' }).expect(201)
    const dup = await alice.set('x-workspace-id', ws).post('/api/projects/tags').send({ name: 'Same' }).expect(400)
    expect(dup.body.error.code).toBe('bad_request')
  })
})

describe('custom questions', () => {
  it('creates and updates questions on a project', async () => {
    const { alice, ws, project } = await ownerWorkspace(server.app)
    const created = await alice
      .set('x-workspace-id', ws)
      .post(`/api/projects/projects/${project.id}/questions`)
      .send({ label: 'What did you love most?', type: 'long', required: true })
      .expect(201)
    expect(created.body.data.question.label).toBe('What did you love most?')

    const list = await alice
      .set('x-workspace-id', ws)
      .get(`/api/projects/projects/${project.id}/questions`)
      .expect(200)
    expect(list.body.data.items).toHaveLength(1)

    const updated = await alice
      .set('x-workspace-id', ws)
      .patch(`/api/projects/questions/${created.body.data.question.id}`)
      .send({ label: 'Changed' })
      .expect(200)
    expect(updated.body.data.question.label).toBe('Changed')
  })

  it('serves custom questions publicly and stores the respondent answers', async () => {
    const { alice, ws, project } = await ownerWorkspace(server.app)
    const created = await alice
      .set('x-workspace-id', ws)
      .post(`/api/projects/projects/${project.id}/questions`)
      .send({ label: 'What did you love most?', type: 'long', required: true })
      .expect(201)
    const questionId = created.body.data.question.id

    const publicPage = await request(server.app)
      .get(`/api/public/business/${project.slug}`)
      .expect(200)
    expect(publicPage.body.data.questions).toEqual([
      expect.objectContaining({ id: questionId, label: 'What did you love most?', required: true }),
    ])

    // Required questions are enforced server-side, not just in the browser.
    const missing = await request(server.app)
      .post(`/api/public/submit/${project.slug}`)
      .send({
        rating: 5,
        name: 'Mara Ellis',
        text: 'They shipped ahead of schedule and the work was excellent.',
      })
      .expect(400)
    expect(missing.body.error.fields.answers).toBeDefined()

    await request(server.app)
      .post(`/api/public/submit/${project.slug}`)
      .send({
        rating: 5,
        name: 'Mara Ellis',
        text: 'They shipped ahead of schedule and the work was excellent.',
        answers: { [questionId]: 'The strategy work was outstanding.' },
      })
      .expect(201)

    const rows = await server.sql(
      'SELECT answers FROM testimonials WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1',
      [project.id],
    )
    expect(rows[0].answers).toEqual({ [questionId]: 'The strategy work was outstanding.' })
  })

  it('keeps a manager from editing a question in another client', async () => {
    const { alice, ws, client } = await ownerWorkspace(server.app)
    // Second client owned by alice.
    const other = await alice
      .set('x-workspace-id', ws)
      .post('/api/workspace/clients')
      .send({ name: 'Globex' })
      .expect(201)
    const otherDetail = await alice
      .set('x-workspace-id', ws)
      .get(`/api/workspace/clients/${other.body.data.client.id}`)
      .expect(200)
    const otherProject = otherDetail.body.data.projects.find((p) => p.isDefault)
    const q = await alice
      .set('x-workspace-id', ws)
      .post(`/api/projects/projects/${otherProject.id}/questions`)
      .send({ label: 'Secret' })
      .expect(201)

    // Bob becomes a manager scoped only to Acme.
    await signup(server.app, 'bob@example.com', 'Bob')
    await alice.set('x-workspace-id', ws).post('/api/workspace/team').send({ email: 'bob@example.com', role: 'manager' }).expect(201)
    const team = await alice.set('x-workspace-id', ws).get('/api/workspace/team').expect(200)
    const bobMember = team.body.data.items.find((m) => m.email === 'bob@example.com')
    await alice
      .set('x-workspace-id', ws)
      .put(`/api/workspace/team/${bobMember.userId}/clients`)
      .send({ clientIds: [client.id] })
      .expect(200)
    const bob = request.agent(server.app)
    await bob.post('/api/auth/login').send({ email: 'bob@example.com', password: VALID_PASSWORD }).expect(200)

    // Bob must not see or edit Globex's question.
    const list = await bob.set('x-workspace-id', ws).get(`/api/projects/projects/${otherProject.id}/questions`).expect(404)
    expect(list.body.error.code).toBe('not_found')
    await bob.set('x-workspace-id', ws).patch(`/api/projects/questions/${q.body.data.question.id}`).send({ label: 'x' }).expect(404)
  })
})

describe('saved widgets', () => {
  it('creates and updates a saved widget config', async () => {
    const { alice, ws, project } = await ownerWorkspace(server.app)
    const created = await alice
      .set('x-workspace-id', ws)
      .post(`/api/projects/projects/${project.id}/widgets`)
      .send({ name: 'Homepage carousel', layout: 'carousel', theme: 'light', accent: '#15803d', showStars: true, showCompany: false })
      .expect(201)
    expect(created.body.data.widget.name).toBe('Homepage carousel')

    const list = await alice.set('x-workspace-id', ws).get(`/api/projects/projects/${project.id}/widgets`).expect(200)
    expect(list.body.data.items).toHaveLength(1)

    const updated = await alice
      .set('x-workspace-id', ws)
      .patch(`/api/projects/widgets/${created.body.data.widget.id}`)
      .send({ name: 'Renamed', layout: 'grid' })
      .expect(200)
    expect(updated.body.data.widget.name).toBe('Renamed')
    expect(updated.body.data.widget.layout).toBe('grid')

    await alice.set('x-workspace-id', ws).delete(`/api/projects/widgets/${created.body.data.widget.id}`).expect(204)
  })
})

describe('analytics', () => {
  it('reports project totals and trend', async () => {
    const { alice, ws, client } = await ownerWorkspace(server.app)
    // Submit a couple of testimonials to the client's default slug.
    await request(server.app).post(`/api/public/submit/${client.slug}`).send({ rating: 5, name: 'Ada', text: 'Fantastic work, would recommend to anyone.' }).expect(201)
    await request(server.app).post(`/api/public/submit/${client.slug}`).send({ rating: 4, name: 'Lin', text: 'Solid results and a smooth handover.' }).expect(201)

    const detail = await alice.set('x-workspace-id', ws).get(`/api/workspace/clients/${client.id}`).expect(200)
    const project = detail.body.data.projects.find((p) => p.isDefault)
    const analytics = await alice.set('x-workspace-id', ws).get(`/api/projects/projects/${project.id}/analytics`).expect(200)
    expect(analytics.body.data.totals.total).toBe(2)
    expect(analytics.body.data.totals.pending).toBe(2)
    expect(analytics.body.data.trend.length).toBeGreaterThan(0)

    const workspace = await alice.set('x-workspace-id', ws).get('/api/projects/analytics').expect(200)
    expect(workspace.body.data.clients).toBe(1)
    expect(workspace.body.data.projects).toBe(1)
    expect(workspace.body.data.pending).toBe(2)
    expect(workspace.body.data.topClients[0].name).toBe('Acme Co')
  })
})

describe('CSV import and export', () => {
  it('exports approved testimonials as CSV', async () => {
    const { alice, ws, client } = await ownerWorkspace(server.app)
    await request(server.app).post(`/api/public/submit/${client.slug}`).send({ rating: 5, name: 'Ada', text: 'Fantastic work, would recommend to anyone.' }).expect(201)
    const detail = await alice.set('x-workspace-id', ws).get(`/api/workspace/clients/${client.id}`).expect(200)
    const project = detail.body.data.projects.find((p) => p.isDefault)

    const csv = await alice.set('x-workspace-id', ws).get(`/api/projects/projects/${project.id}/export.csv`).expect(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.text).toContain('Ada')
    expect(csv.text.split('\n')[0]).toContain('name,company,rating,status')
  })

  it('previews then commits an import', async () => {
    const { alice, ws, client } = await ownerWorkspace(server.app)
    const detail = await alice.set('x-workspace-id', ws).get(`/api/workspace/clients/${client.id}`).expect(200)
    const project = detail.body.data.projects.find((p) => p.isDefault)

    const rows = [
      { name: 'Mira Vance', company: 'Northwind', rating: '5', text: 'The rollout was smooth and the support was excellent.' },
      { name: 'Theo Park', company: 'Initech', rating: '4', text: 'Great collaboration and clear communication throughout.' },
    ]
    const preview = await alice
      .set('x-workspace-id', ws)
      .post(`/api/projects/projects/${project.id}/import`)
      .send({ rows, commit: false })
      .expect(200)
    expect(preview.body.data.preview).toHaveLength(2)
    expect(preview.body.data.committed).toBe(false)

    const committed = await alice
      .set('x-workspace-id', ws)
      .post(`/api/projects/projects/${project.id}/import`)
      .send({ rows, commit: true })
      .expect(201)
    expect(committed.body.data.imported).toBe(2)

    const analytics = await alice.set('x-workspace-id', ws).get(`/api/projects/projects/${project.id}/analytics`).expect(200)
    expect(analytics.body.data.totals.total).toBe(2)
  })

  it('rejects a malformed import row before commit', async () => {
    const { alice, ws, client } = await ownerWorkspace(server.app)
    const detail = await alice.set('x-workspace-id', ws).get(`/api/workspace/clients/${client.id}`).expect(200)
    const project = detail.body.data.projects.find((p) => p.isDefault)
    const rows = [{ name: 'Bad', text: 'too short' }]
    const res = await alice.set('x-workspace-id', ws).post(`/api/projects/projects/${project.id}/import`).send({ rows }).expect(200)
    expect(res.body.data.errors.length).toBeGreaterThan(0)
  })
})
