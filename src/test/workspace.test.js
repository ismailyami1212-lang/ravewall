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

/** Signs a brand-new user up and returns a cookie-carrying agent. */
function signup(app, email, name = 'Owner') {
  const agent = request.agent(app)
  return agent.post('/api/auth/signup').send({ email, password: VALID_PASSWORD, name }).expect(201).then(() => agent)
}

/** Reads the active workspace id from the /account endpoint. */
async function workspaceId(agent) {
  const res = await agent.get('/api/account').expect(200)
  return res.body.data.workspace.id
}

/** Reads the current user id from the /account endpoint. */
async function userId(agent) {
  const res = await agent.get('/api/account').expect(200)
  return res.body.data.user.id
}

function withWs(agent, wsId) {
  return agent.set('x-workspace-id', wsId)
}

/** Test setup: move a workspace onto a paid plan so multiple clients are allowed. */
async function upgrade(wsId, plan = 'starter') {
  await server.sql('UPDATE workspaces SET plan = $2 WHERE id = $1', [wsId, plan])
}

describe('workspace bootstrap', () => {
  it('gives every new account a workspace and owner role', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const res = await alice.get('/api/workspace/').expect(200)
    expect(res.body.data.role).toBe('owner')
    expect(res.body.data.workspace).toMatchObject({ name: 'Alice', plan: 'free' })
    expect(res.body.data.counts).toMatchObject({ clients: 0, projects: 0 })
  })

  it('exposes memberships on /me', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const res = await alice.get('/api/auth/me').expect(200)
    expect(res.body.data.memberships).toHaveLength(1)
    expect(res.body.data.memberships[0].role).toBe('owner')
    expect(res.body.data.workspace.plan).toBe('free')
  })
})

describe('client lifecycle', () => {
  it('creates and lists clients for the active workspace', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)

    const created = await withWs(alice, ws)
      .post('/api/workspace/clients')
      .send({ name: 'Acme Co' })
      .expect(201)
    expect(created.body.data.client.slug).toBe('acme-co')
    expect(created.body.data.client.accentColor).toBe('#15803d')

    const listed = await withWs(alice, ws).get('/api/workspace/clients').expect(200)
    expect(listed.body.data.items.map((c) => c.slug)).toContain('acme-co')
  })

  it('auto-generates a default project per client', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    const created = await withWs(alice, ws)
      .post('/api/workspace/clients')
      .send({ name: 'Globex' })
      .expect(201)

    const detail = await withWs(alice, ws)
      .get(`/api/workspace/clients/${created.body.data.client.id}`)
      .expect(200)
    expect(detail.body.data.projects).toHaveLength(1)
    expect(detail.body.data.projects[0].isDefault).toBe(true)
    expect(detail.body.data.projects[0].slug).toBe('globex')
  })

  it('rejects a duplicate slug within a workspace', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    await withWs(alice, ws).post('/api/workspace/clients').send({ name: 'Acme Co' }).expect(201)
    await upgrade(ws)
    const dup = await withWs(alice, ws)
      .post('/api/workspace/clients')
      .send({ name: 'acme-co', slug: 'acme-co' })
      .expect(409)
    expect(dup.body.error.fields.slug).toBeDefined()
  })

  it('persists branding from the client detail editor, including the accent alias', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    const created = await withWs(alice, ws)
      .post('/api/workspace/clients')
      .send({ name: 'Acme Co' })
      .expect(201)
    const clientId = created.body.data.client.id

    const patched = await withWs(alice, ws)
      .patch(`/api/workspace/clients/${clientId}`)
      .send({
        tagline: 'Brand systems that ship',
        logoUrl: 'https://cdn.example.com/acme.png',
        accent: '#7c3aed',
      })
      .expect(200)
    expect(patched.body.data.client).toMatchObject({
      tagline: 'Brand systems that ship',
      logoUrl: 'https://cdn.example.com/acme.png',
      accentColor: '#7c3aed',
    })

    const persisted = await withWs(alice, ws)
      .get(`/api/workspace/clients/${clientId}`)
      .expect(200)
    expect(persisted.body.data.client).toMatchObject({
      tagline: 'Brand systems that ship',
      logoUrl: 'https://cdn.example.com/acme.png',
      accentColor: '#7c3aed',
    })
  })

  it('renames a client but keeps the workspace', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    const created = await withWs(alice, ws)
      .post('/api/workspace/clients')
      .send({ name: 'Acme Co' })
      .expect(201)
    const patched = await withWs(alice, ws)
      .patch(`/api/workspace/clients/${created.body.data.client.id}`)
      .send({ name: 'Acme Studios' })
      .expect(200)
    expect(patched.body.data.client.name).toBe('Acme Studios')
    expect(patched.body.data.client.slug).toBe('acme-co')
  })

  it('refuses to delete the last remaining client', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    await upgrade(ws)
    const created = await withWs(alice, ws)
      .post('/api/workspace/clients')
      .send({ name: 'Acme Co' })
      .expect(201)
    const second = await withWs(alice, ws)
      .post('/api/workspace/clients')
      .send({ name: 'Globex' })
      .expect(201)
    await withWs(alice, ws).delete(`/api/workspace/clients/${second.body.data.client.id}`).expect(204)
    const last = await withWs(alice, ws)
      .delete(`/api/workspace/clients/${created.body.data.client.id}`)
      .expect(409)
    expect(last.body.error.code).toBe('conflict')
  })
})

describe('project lifecycle', () => {
  it('creates a project under a client', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    const client = await withWs(alice, ws)
      .post('/api/workspace/clients')
      .send({ name: 'Acme Co' })
      .expect(201)

    const project = await withWs(alice, ws)
      .post(`/api/workspace/clients/${client.body.data.client.id}/projects`)
      .send({ name: 'Spring Launch' })
      .expect(201)
    expect(project.body.data.project.slug).toBe('acme-co-spring-launch')

    const listed = await withWs(alice, ws).get('/api/workspace/projects').expect(200)
    expect(listed.body.data.items.length).toBe(2) // default + new
  })

  it('cannot delete the default project', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    const client = await withWs(alice, ws)
      .post('/api/workspace/clients')
      .send({ name: 'Acme Co' })
      .expect(201)
    const detail = await withWs(alice, ws)
      .get(`/api/workspace/clients/${client.body.data.client.id}`)
      .expect(200)
    const def = detail.body.data.projects.find((p) => p.isDefault)
    const res = await withWs(alice, ws).delete(`/api/workspace/projects/${def.id}`).expect(409)
    expect(res.body.error.code).toBe('conflict')
  })
})

describe('tenant isolation', () => {
  it('never reveals another workspace through a guessed id', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    await withWs(alice, ws).post('/api/workspace/clients').send({ name: 'Acme Co' }).expect(201)

    const dave = await signup(server.app, 'dave@example.com', 'Dave')
    // Dave's own workspace (no header) is empty but valid — 200, not 404.
    const own = await dave.get('/api/workspace/clients').expect(200)
    expect(own.body.data.items).toHaveLength(0)
    // A guessed workspace id Dave is not a member of must 404, never leak.
    const res = await withWs(dave, ws).get('/api/workspace/clients').expect(404)
    expect(res.body.error.code).toBe('not_found')
  })

  it('scopes a manager to only their assigned clients', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    await upgrade(ws)
    const acme = await withWs(alice, ws).post('/api/workspace/clients').send({ name: 'Acme Co' }).expect(201)
    const globex = await withWs(alice, ws).post('/api/workspace/clients').send({ name: 'Globex' }).expect(201)

    const bob = await signup(server.app, 'bob@example.com', 'Bob')
    await withWs(alice, ws)
      .post('/api/workspace/team')
      .send({ email: 'bob@example.com', role: 'manager' })
      .expect(201)
    const bobUid = await userId(bob)

    // Assign Bob to Acme only.
    await withWs(alice, ws)
      .put(`/api/workspace/team/${bobUid}/clients`)
      .send({ clientIds: [acme.body.data.client.id] })
      .expect(200)

    const seen = await withWs(bob, ws).get('/api/workspace/clients').expect(200)
    expect(seen.body.data.items.map((c) => c.id)).toEqual([acme.body.data.client.id])

    // Globex is out of scope → 404, not 403 (no hint it exists).
    await withWs(bob, ws).get(`/api/workspace/clients/${globex.body.data.client.id}`).expect(404)
  })
})

describe('agency roles & permissions', () => {
  async function addMember(owner, ws, email, role) {
    await withWs(owner, ws).post('/api/workspace/team').send({ email, role }).expect(201)
    const team = await withWs(owner, ws).get('/api/workspace/team').expect(200)
    const member = team.body.data.items.find((m) => m.email === email)
    return member
  }

  it('lets owners add, demote and remove members', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    await signup(server.app, 'bob@example.com', 'Bob')

    const bob = await addMember(alice, ws, 'bob@example.com', 'manager')
    expect(bob.role).toBe('manager')

    const demoted = await withWs(alice, ws)
      .patch(`/api/workspace/team/${bob.userId}`)
      .send({ role: 'viewer' })
      .expect(200)
    expect(demoted.body.data.member.role).toBe('viewer')

    await withWs(alice, ws).delete(`/api/workspace/team/${bob.userId}`).expect(204)
    const team = await withWs(alice, ws).get('/api/workspace/team').expect(200)
    expect(team.body.data.items.filter((m) => m.email === 'bob@example.com')).toHaveLength(0)
  })

  it('blocks a manager from managing the team or clients', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    await withWs(alice, ws).post('/api/workspace/clients').send({ name: 'Acme Co' }).expect(201)

    await signup(server.app, 'bob@example.com', 'Bob')
    const bobMember = await addMember(alice, ws, 'bob@example.com', 'manager')
    const bob = request.agent(server.app)
    await bob.post('/api/auth/login').send({ email: 'bob@example.com', password: VALID_PASSWORD }).expect(200)

    await withWs(bob, ws).post('/api/workspace/team').send({ email: 'x@example.com', role: 'viewer' }).expect(403)
    await withWs(bob, ws).post('/api/workspace/clients').send({ name: 'Forbidden' }).expect(403)
  })

  it('lets a manager create projects on an assigned client', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    const acme = await withWs(alice, ws).post('/api/workspace/clients').send({ name: 'Acme Co' }).expect(201)

    await signup(server.app, 'bob@example.com', 'Bob')
    const bobMember = await addMember(alice, ws, 'bob@example.com', 'manager')
    await withWs(alice, ws)
      .put(`/api/workspace/team/${bobMember.userId}/clients`)
      .send({ clientIds: [acme.body.data.client.id] })
      .expect(200)
    const bob = request.agent(server.app)
    await bob.post('/api/auth/login').send({ email: 'bob@example.com', password: VALID_PASSWORD }).expect(200)

    const project = await withWs(bob, ws)
      .post(`/api/workspace/clients/${acme.body.data.client.id}/projects`)
      .send({ name: 'Campaign' })
      .expect(201)
    expect(project.body.data.project).toBeDefined()
  })

  it('blocks a manager from changing any team role (403 before escalation check)', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    await signup(server.app, 'bob@example.com', 'Bob')
    const bobMember = await addMember(alice, ws, 'bob@example.com', 'manager')
    const bob = request.agent(server.app)
    await bob.post('/api/auth/login').send({ email: 'bob@example.com', password: VALID_PASSWORD }).expect(200)

    // A manager cannot manage the team at all, so even a self-role change is 403.
    const res = await withWs(bob, ws)
      .patch(`/api/workspace/team/${bobMember.userId}`)
      .send({ role: 'owner' })
      .expect(403)
    expect(res.body.error.code).toBe('forbidden')
  })

  it('stops an admin from changing their own role', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    await signup(server.app, 'bob@example.com', 'Bob')
    const bobMember = await addMember(alice, ws, 'bob@example.com', 'admin')
    const bob = request.agent(server.app)
    await bob.post('/api/auth/login').send({ email: 'bob@example.com', password: VALID_PASSWORD }).expect(200)

    // An admin can manage the team, but may not change their own role — this
    // blocks both self-demotion and accidental self-escalation paths.
    const demote = await withWs(bob, ws)
      .patch(`/api/workspace/team/${bobMember.userId}`)
      .send({ role: 'viewer' })
      .expect(409)
    expect(demote.body.error.code).toBe('conflict')

    const escalate = await withWs(bob, ws)
      .patch(`/api/workspace/team/${bobMember.userId}`)
      .send({ role: 'owner' })
      .expect(409)
    expect(escalate.body.error.code).toBe('conflict')

    const team = await withWs(alice, ws).get('/api/workspace/team').expect(200)
    expect(team.body.data.items.find((m) => m.email === 'bob@example.com').role).toBe('admin')
  })

  it('never falls back to legacy owner_user_id access after membership is removed', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    const bob = await signup(server.app, 'bob@example.com', 'Bob')
    const bobWs = await workspaceId(bob)
    const bobUid = await userId(bob)

    await withWs(alice, ws).post('/api/workspace/team').send({ email: 'bob@example.com', role: 'manager' }).expect(201)

    // Simulate a legacy row: Bob created this client, but membership is what
    // grants access. Remove his membership and his own workspace so he has no
    // active membership anywhere.
    await server.sql(
      `INSERT INTO businesses (workspace_id, owner_user_id, name, slug)
       VALUES ($1, $2, 'Legacy Client', 'legacy-client')`,
      [ws, bobUid],
    )
    await withWs(alice, ws).delete(`/api/workspace/team/${bobUid}`).expect(204)
    await server.sql('DELETE FROM workspace_members WHERE user_id = $1', [bobUid])
    await server.sql('DELETE FROM workspaces WHERE id = $1', [bobWs])

    const bobAgent = request.agent(server.app)
    const login = await bobAgent
      .post('/api/auth/login')
      .send({ email: 'bob@example.com', password: VALID_PASSWORD })
      .expect(200)
    expect(login.body.data.business).toBeNull()

    const business = await bobAgent.get('/api/business').expect(200)
    expect(business.body.data.business).toBeNull()
    await bobAgent.get('/api/workspace/').expect(404)
  })

  it('keeps at least one owner when demoting', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    await signup(server.app, 'bob@example.com', 'Bob')
    const bobMember = await addMember(alice, ws, 'bob@example.com', 'admin')

    // Bob (admin) tries to demote Alice, the only owner.
    const bob = request.agent(server.app)
    await bob.post('/api/auth/login').send({ email: 'bob@example.com', password: VALID_PASSWORD }).expect(200)
    const res = await withWs(bob, ws)
      .patch(`/api/workspace/team/${await userId(alice)}`)
      .send({ role: 'viewer' })
      .expect(409)
    expect(res.body.error.code).toBe('conflict')
  })

  it('blocks removing yourself', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    const aliceUid = await userId(alice)
    await withWs(alice, ws).delete(`/api/workspace/team/${aliceUid}`).expect(409)
  })
})

describe('workspace rename & unknown workspace', () => {
  it('renames the workspace', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    const res = await withWs(alice, ws).patch('/api/workspace/').send({ name: 'Acme Agency' }).expect(200)
    expect(res.body.data.workspace.name).toBe('Acme Agency')
  })

  it('refuses rename from a non-admin role', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const ws = await workspaceId(alice)
    await signup(server.app, 'bob@example.com', 'Bob')
    await withWs(alice, ws).post('/api/workspace/team').send({ email: 'bob@example.com', role: 'manager' }).expect(201)
    const bob = request.agent(server.app)
    await bob.post('/api/auth/login').send({ email: 'bob@example.com', password: VALID_PASSWORD }).expect(200)
    await withWs(bob, ws).patch('/api/workspace/').send({ name: 'Hacked' }).expect(403)
  })
})
