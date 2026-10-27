import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VALID_PASSWORD,
  createTestServer,
  seedAccount,
  submitTestimonial,
} from './helpers/server.js'

let server

function signup(app, email, name) {
  const agent = request.agent(app)
  return agent
    .post('/api/auth/signup')
    .send({ email, password: VALID_PASSWORD, name })
    .expect(201)
    .then(() => agent)
}

function stubResend() {
  const mock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'email_test' }),
  }))
  vi.stubGlobal('fetch', mock)
  return mock
}

function emailBodies(mock) {
  return mock.mock.calls.map((call) => JSON.parse(String(call[1].body)))
}

beforeEach(async () => {
  server = await createTestServer({
    resendApiKey: 're_test_key',
    emailFrom: 'RaveWall <hello@ravewall.test>',
  })
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await server.cleanup()
})

describe('transactional notifications', () => {
  it('emails workspace owners and managers when a testimonial arrives', async () => {
    const owner = await seedAccount(request, server.app, {
      email: 'mara@example.com',
      name: 'Mara Ellis',
      slug: 'northwind',
      businessName: 'Northwind Studio',
    })
    const ws = (await owner.get('/api/account').expect(200)).body.data.workspace.id

    await signup(server.app, 'tobias@example.com', 'Tobias Lang')
    const fetchMock = stubResend()
    await owner
      .set('x-workspace-id', ws)
      .post('/api/workspace/team')
      .send({ email: 'tobias@example.com', role: 'manager' })
      .expect(201)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const team = await owner.set('x-workspace-id', ws).get('/api/workspace/team').expect(200)
    const manager = team.body.data.items.find((member) => member.email === 'tobias@example.com')
    const clients = await owner.set('x-workspace-id', ws).get('/api/workspace/clients').expect(200)
    const client = clients.body.data.items.find((item) => item.slug === 'northwind')
    await owner
      .set('x-workspace-id', ws)
      .put(`/api/workspace/team/${manager.userId}/clients`)
      .send({ clientIds: [client.id] })
      .expect(200)
    fetchMock.mockClear()

    const submitted = await submitTestimonial(server.app, 'northwind', {
      name: 'Jamie Rivera',
      text: 'They shipped our launch a week early and the team was lovely.',
    })
    expect(submitted.status).toBe(201)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const messages = emailBodies(fetchMock)
    expect(messages.map((message) => message.to[0]).sort()).toEqual([
      'mara@example.com',
      'tobias@example.com',
    ])
    expect(messages[0].subject).toMatch(/Northwind Studio/i)
    expect(messages[0].text).toContain('Jamie Rivera')
    expect(messages[0].text).toContain('shipped our launch a week early')
  })

  it('does not let a viewer receive submission alerts', async () => {
    const owner = await seedAccount(request, server.app, {
      email: 'mara@example.com',
      name: 'Mara Ellis',
      slug: 'northwind',
      businessName: 'Northwind Studio',
    })
    const ws = (await owner.get('/api/account').expect(200)).body.data.workspace.id

    await signup(server.app, 'viewer@example.com', 'Vera Viewer')
    const fetchMock = stubResend()
    await owner
      .set('x-workspace-id', ws)
      .post('/api/workspace/team')
      .send({ email: 'viewer@example.com', role: 'viewer' })
      .expect(201)
    fetchMock.mockClear()

    await submitTestimonial(server.app, 'northwind')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(emailBodies(fetchMock)[0].to[0]).toBe('mara@example.com')
  })

  it('sends a team invitation email when a member is added', async () => {
    const owner = await seedAccount(request, server.app, {
      email: 'mara@example.com',
      name: 'Mara Ellis',
      slug: 'northwind',
      businessName: 'Northwind Studio',
    })
    const account = (await owner.get('/api/account').expect(200)).body.data
    const ws = account.workspace.id

    await signup(server.app, 'tobias@example.com', 'Tobias Lang')
    const fetchMock = stubResend()

    await owner
      .set('x-workspace-id', ws)
      .post('/api/workspace/team')
      .send({ email: 'tobias@example.com', role: 'manager' })
      .expect(201)

    const [message] = emailBodies(fetchMock)
    expect(message.to).toEqual(['tobias@example.com'])
    expect(message.subject).toMatch(/invited/i)
    expect(message.text).toContain('Mara Ellis')
    expect(message.text).toContain(account.workspace.name)
    expect(message.text).toContain('Manager')
    expect(message.html).toContain('Open your workspace')
  })
})
