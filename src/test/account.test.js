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

describe('account profile', () => {
  it('returns the current user, workspace and role', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const res = await alice.get('/api/account').expect(200)
    expect(res.body.data.user.email).toBe('alice@example.com')
    expect(res.body.data.role).toBe('owner')
    expect(res.body.data.workspace.plan).toBe('free')
  })

  it('updates the name and email', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const res = await alice.patch('/api/account').send({ name: 'Alice Mara', email: 'alice.mara@example.com' }).expect(200)
    expect(res.body.data.user.name).toBe('Alice Mara')
    expect(res.body.data.user.email).toBe('alice.mara@example.com')
  })

  it('rejects an email that is already taken', async () => {
    await signup(server.app, 'alice@example.com', 'Alice')
    const bob = await signup(server.app, 'bob@example.com', 'Bob')
    const res = await bob.patch('/api/account').send({ email: 'alice@example.com' }).expect(409)
    expect(res.body.error.code).toBe('conflict')
  })
})

describe('password', () => {
  it('changes the password and ends other sessions', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    // A second active session.
    const other = request.agent(server.app)
    await other.post('/api/auth/login').send({ email: 'alice@example.com', password: VALID_PASSWORD }).expect(200)

    const before = (await alice.get('/api/account/sessions').expect(200)).body.data.items.length
    expect(before).toBe(2)

    const res = await alice.post('/api/account/password').send({ currentPassword: VALID_PASSWORD, newPassword: 'N3wPass!9' }).expect(200)
    expect(res.body.data.otherSessionsEnded).toBe(1)

    // The new password works.
    await request(server.app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'N3wPass!9' }).expect(200)
    // The old password does not.
    await request(server.app).post('/api/auth/login').send({ email: 'alice@example.com', password: VALID_PASSWORD }).expect(401)
  })

  it('rejects a wrong current password', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const res = await alice.post('/api/account/password').send({ currentPassword: 'wrong', newPassword: 'N3wPass!9' }).expect(400)
    expect(res.body.error.fields.currentPassword).toBeDefined()
  })
})

describe('sessions', () => {
  it('lists sessions and can revoke others', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const other = request.agent(server.app)
    await other.post('/api/auth/login').send({ email: 'alice@example.com', password: VALID_PASSWORD }).expect(200)

    const list = await alice.get('/api/account/sessions').expect(200)
    expect(list.body.data.items.length).toBe(2)
    expect(list.body.data.items.filter((s) => s.current).length).toBe(1)

    const otherSession = list.body.data.items.find((s) => !s.current)
    await alice.delete(`/api/account/sessions/${otherSession.id}`).expect(204)

    const after = await alice.get('/api/account/sessions').expect(200)
    expect(after.body.data.items).toHaveLength(1)
  })

  it('refuses to revoke the current session', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const list = await alice.get('/api/account/sessions').expect(200)
    const current = list.body.data.items.find((s) => s.current)
    const res = await alice.delete(`/api/account/sessions/${current.id}`).expect(409)
    expect(res.body.error.code).toBe('conflict')
  })

  it('can end every other session at once', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    const other = request.agent(server.app)
    await other.post('/api/auth/login').send({ email: 'alice@example.com', password: VALID_PASSWORD }).expect(200)
    const res = await alice.delete('/api/account/sessions').expect(200)
    expect(res.body.data.ended).toBe(1)
  })
})

describe('account deletion', () => {
  it('refuses deletion while sharing a workspace', async () => {
    const alice = await signup(server.app, 'alice@example.com', 'Alice')
    await signup(server.app, 'bob@example.com', 'Bob')
    const ws = (await alice.get('/api/account').expect(200)).body.data.workspace.id
    await alice.set('x-workspace-id', ws).post('/api/workspace/team').send({ email: 'bob@example.com', role: 'manager' }).expect(201)

    const bob = request.agent(server.app)
    await bob.post('/api/auth/login').send({ email: 'bob@example.com', password: VALID_PASSWORD }).expect(200)
    const res = await bob.delete('/api/account').send({ password: VALID_PASSWORD }).expect(409)
    expect(res.body.error.code).toBe('conflict')
  })

  it('deletes a sole-member account', async () => {
    const carol = await signup(server.app, 'carol@example.com', 'Carol')
    await carol.delete('/api/account').send({ password: VALID_PASSWORD }).expect(204)

    // The account and its workspace are gone.
    const me = await carol.get('/api/auth/me').expect(200)
    expect(me.body.data.user).toBeNull()
    expect(await server.sql('SELECT 1 FROM users WHERE email = $1', ['carol@example.com'])).toHaveLength(0)
  })

  it('requires the password to confirm deletion', async () => {
    const carol = await signup(server.app, 'carol@example.com', 'Carol')
    const res = await carol.delete('/api/account').send({ password: 'wrong' }).expect(400)
    expect(res.body.error.fields.password).toBeDefined()
  })
})
