import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VALID_PASSWORD, createTestServer } from './helpers/server.js'

const PRICES = {
  starter: 'price_starter',
  pro: 'price_pro',
  agency: 'price_agency',
}

const BILLING_CONFIG = {
  billingEnabled: true,
  stripeSecretKey: 'sk_test_123',
  stripeWebhookSecret: 'whsec_test_123',
  stripePrices: PRICES,
}

/** Stripe-shaped fake. No network, no credentials. */
function fakeStripe() {
  return {
    customers: {
      create: vi.fn(async () => ({ id: 'cus_test' })),
    },
    checkout: {
      sessions: {
        create: vi.fn(async () => ({ url: 'https://checkout.stripe.test/session' })),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async () => ({ url: 'https://billing.stripe.test/session' })),
      },
    },
    subscriptions: {
      retrieve: vi.fn(async () => ({
        id: 'sub_test',
        status: 'active',
        items: { data: [{ price: { id: 'price_starter' } }] },
      })),
    },
    webhooks: {
      constructEvent: vi.fn((payload) => JSON.parse(String(payload))),
    },
  }
}

let server

beforeEach(async () => {
  server = null
})

afterEach(async () => {
  await server?.cleanup()
})

async function boot(stripe, overrides = {}) {
  server = await createTestServer({ ...BILLING_CONFIG, ...overrides }, { stripe })
  return server
}

function signup(email, name = 'Owner') {
  const agent = request.agent(server.app)
  return agent
    .post('/api/auth/signup')
    .send({ email, password: VALID_PASSWORD, name })
    .expect(201)
    .then(() => agent)
}

async function workspaceId(agent) {
  const res = await agent.get('/api/account').expect(200)
  return res.body.data.workspace.id
}

function withWs(agent, wsId) {
  return agent.set('x-workspace-id', wsId)
}

async function addMember(owner, ws, email, role) {
  await withWs(owner, ws).post('/api/workspace/team').send({ email, role }).expect(201)
  const team = await withWs(owner, ws).get('/api/workspace/team').expect(200)
  return team.body.data.items.find((member) => member.email === email)
}

describe('Stripe checkout', () => {
  it('creates a checkout session for the workspace and stores the customer id', async () => {
    const stripe = fakeStripe()
    await boot(stripe)
    const owner = await signup('owner@example.com')
    const ws = await workspaceId(owner)

    const res = await withWs(owner, ws)
      .post('/api/billing/checkout')
      .send({ plan: 'starter' })
      .expect(200)
    expect(res.body.data.url).toBe('https://checkout.stripe.test/session')

    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        name: 'Owner',
        metadata: { workspace_id: ws },
      }),
    )

    const checkout = stripe.checkout.sessions.create.mock.calls[0][0]
    expect(checkout).toMatchObject({
      mode: 'subscription',
      customer: 'cus_test',
      client_reference_id: ws,
      line_items: [{ price: 'price_starter', quantity: 1 }],
      metadata: { workspace_id: ws, plan: 'starter' },
      subscription_data: { metadata: { workspace_id: ws, plan: 'starter' } },
      success_url: 'https://ravewall.test/settings?billing=success',
      cancel_url: 'https://ravewall.test/pricing?billing=cancelled',
    })

    const [row] = await server.sql(
      'SELECT plan, stripe_customer_id, stripe_subscription_id FROM workspaces WHERE id = $1',
      [ws],
    )
    expect(row.plan).toBe('free') // checkout does not grant access before payment
    expect(row.stripe_customer_id).toBe('cus_test')
    expect(row.stripe_subscription_id).toBeNull()

    // A second checkout reuses the customer rather than creating another one.
    await withWs(owner, ws).post('/api/billing/checkout').send({ priceId: 'price_pro' }).expect(200)
    expect(stripe.customers.create).toHaveBeenCalledTimes(1)
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(2)
  })

  it('rejects an arbitrary or mismatched price id before calling Stripe', async () => {
    const stripe = fakeStripe()
    await boot(stripe)
    const owner = await signup('owner@example.com')
    const ws = await workspaceId(owner)

    const unknown = await withWs(owner, ws)
      .post('/api/billing/checkout')
      .send({ priceId: 'price_attacker' })
      .expect(400)
    expect(unknown.body.error.code).toBe('bad_request')

    const mismatch = await withWs(owner, ws)
      .post('/api/billing/checkout')
      .send({ plan: 'starter', priceId: 'price_pro' })
      .expect(400)
    expect(mismatch.body.error.code).toBe('bad_request')

    expect(stripe.customers.create).not.toHaveBeenCalled()
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('does not let a manager start a checkout', async () => {
    const stripe = fakeStripe()
    await boot(stripe)
    const owner = await signup('owner@example.com')
    const ws = await workspaceId(owner)
    await signup('manager@example.com', 'Manager')
    await addMember(owner, ws, 'manager@example.com', 'manager')

    const manager = request.agent(server.app)
    await manager
      .post('/api/auth/login')
      .send({ email: 'manager@example.com', password: VALID_PASSWORD })
      .expect(200)

    await withWs(manager, ws)
      .post('/api/billing/checkout')
      .send({ plan: 'pro' })
      .expect(403)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('fails closed when billing is not configured', async () => {
    const stripe = fakeStripe()
    await boot(stripe, { billingEnabled: false })
    const owner = await signup('owner@example.com')
    const ws = await workspaceId(owner)

    const res = await withWs(owner, ws)
      .post('/api/billing/checkout')
      .send({ plan: 'starter' })
      .expect(503)
    expect(res.body.error.code).toBe('billing_unavailable')
  })
})

describe('Stripe customer portal', () => {
  it('requires an existing customer and then opens the portal', async () => {
    const stripe = fakeStripe()
    await boot(stripe)
    const owner = await signup('owner@example.com')
    const ws = await workspaceId(owner)

    const before = await withWs(owner, ws).post('/api/billing/portal').expect(409)
    expect(before.body.error.code).toBe('conflict')

    await withWs(owner, ws).post('/api/billing/checkout').send({ plan: 'starter' }).expect(200)

    const res = await withWs(owner, ws).post('/api/billing/portal').expect(200)
    expect(res.body.data.url).toBe('https://billing.stripe.test/session')
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_test',
      return_url: 'https://ravewall.test/settings?billing=portal',
    })
  })
})

describe('Stripe webhooks', () => {
  function send(webhook, event, signature = 't=1,v1=good') {
    return request(server.app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', signature)
      .send(event)
  }

  it('verifies the raw body and activates the plan on checkout completion', async () => {
    const stripe = fakeStripe()
    stripe.subscriptions.retrieve.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      items: { data: [{ price: { id: 'price_pro' } }] },
    })
    await boot(stripe)
    const owner = await signup('owner@example.com')
    const ws = await workspaceId(owner)

    const event = {
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_123',
          subscription: 'sub_123',
          metadata: { workspace_id: ws, plan: 'starter' },
        },
      },
    }
    const res = await send(stripe.webhooks, event).expect(200)
    expect(res.body).toEqual({ received: true })

    expect(stripe.webhooks.constructEvent).toHaveBeenCalledTimes(1)
    const [raw, signature, secret] = stripe.webhooks.constructEvent.mock.calls[0]
    expect(Buffer.isBuffer(raw)).toBe(true)
    expect(JSON.parse(raw.toString())).toEqual(event)
    expect(signature).toBe('t=1,v1=good')
    expect(secret).toBe('whsec_test_123')
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_123')

    const [row] = await server.sql(
      `SELECT plan, stripe_customer_id, stripe_subscription_id, subscription_status
         FROM workspaces WHERE id = $1`,
      [ws],
    )
    expect(row).toEqual({
      plan: 'pro',
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_123',
      subscription_status: 'active',
    })
  })

  it('rejects a missing or invalid signature without touching the workspace', async () => {
    const stripe = fakeStripe()
    stripe.webhooks.constructEvent.mockImplementation((_raw, signature) => {
      if (signature !== 't=1,v1=good') throw new Error('bad signature')
      return {}
    })
    await boot(stripe)
    const owner = await signup('owner@example.com')
    const ws = await workspaceId(owner)

    await request(server.app)
      .post('/api/webhooks/stripe')
      .send({ type: 'customer.subscription.deleted', data: { object: {} } })
      .expect(400)

    const event = {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_123', customer: 'cus_123', metadata: { workspace_id: ws } } },
    }
    await send(stripe.webhooks, event, 't=1,v1=bad').expect(400)

    const [row] = await server.sql('SELECT plan, stripe_customer_id FROM workspaces WHERE id = $1', [ws])
    expect(row).toEqual({ plan: 'free', stripe_customer_id: null })
  })

  it('syncs active, canceled and deleted subscription states', async () => {
    const stripe = fakeStripe()
    await boot(stripe)
    const owner = await signup('owner@example.com')
    const ws = await workspaceId(owner)
    await server.sql(
      `UPDATE workspaces
          SET plan = 'starter', stripe_customer_id = 'cus_1', stripe_subscription_id = 'sub_1'
        WHERE id = $1`,
      [ws],
    )

    const subscription = {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      metadata: { workspace_id: ws },
      items: { data: [{ price: { id: 'price_pro' } }] },
    }
    await send(stripe.webhooks, {
      type: 'customer.subscription.updated',
      data: { object: subscription },
    }).expect(200)
    let [row] = await server.sql(
      'SELECT plan, subscription_status FROM workspaces WHERE id = $1',
      [ws],
    )
    expect(row).toEqual({ plan: 'pro', subscription_status: 'active' })

    await send(stripe.webhooks, {
      type: 'customer.subscription.updated',
      data: { object: { ...subscription, status: 'canceled' } },
    }).expect(200)
    ;[row] = await server.sql('SELECT plan, subscription_status FROM workspaces WHERE id = $1', [ws])
    expect(row).toEqual({ plan: 'free', subscription_status: 'canceled' })

    await send(stripe.webhooks, {
      type: 'customer.subscription.deleted',
      data: { object: { ...subscription, status: 'canceled' } },
    }).expect(200)
    ;[row] = await server.sql(
      `SELECT plan, stripe_customer_id, stripe_subscription_id, subscription_status
         FROM workspaces WHERE id = $1`,
      [ws],
    )
    expect(row).toEqual({
      plan: 'free',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      subscription_status: 'canceled',
    })
  })

  it('ignores unknown event types after verifying them', async () => {
    const stripe = fakeStripe()
    await boot(stripe)
    await request(server.app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=good')
      .send({ type: 'invoice.paid', data: { object: {} } })
      .expect(200)
  })
})

describe('plan entitlements', () => {
  it('enforces the client limit for Free, Starter and Agency plans', async () => {
    await boot(fakeStripe(), { billingEnabled: false })
    const owner = await signup('owner@example.com')
    const ws = await workspaceId(owner)

    const createClient = (name) =>
      withWs(owner, ws).post('/api/workspace/clients').send({ name })

    await createClient('First Client').expect(201)
    const blocked = await createClient('Second Client').expect(402)
    expect(blocked.body.error.code).toBe('plan_limit_reached')
    expect(blocked.body.error.message).toMatch(/Free plan includes 1 client/i)

    let [row] = await server.sql('SELECT count(*)::int AS n FROM businesses WHERE workspace_id = $1', [ws])
    expect(row.n).toBe(1)

    await server.sql("UPDATE workspaces SET plan = 'starter' WHERE id = $1", [ws])
    await createClient('Second Client').expect(201)
    await createClient('Third Client').expect(201)
    const starterBlocked = await createClient('Fourth Client').expect(402)
    expect(starterBlocked.body.error.message).toMatch(/Starter plan includes 3 clients/i)

    const workspace = await withWs(owner, ws).get('/api/workspace/').expect(200)
    expect(workspace.body.data.limits).toEqual({ clients: 3, projects: null })

    await server.sql("UPDATE workspaces SET plan = 'agency' WHERE id = $1", [ws])
    await createClient('Fourth Client').expect(201)
    const agency = await withWs(owner, ws).get('/api/workspace/').expect(200)
    expect(agency.body.data.limits).toEqual({ clients: null, projects: null })

    ;[row] = await server.sql('SELECT count(*)::int AS n FROM businesses WHERE workspace_id = $1', [ws])
    expect(row.n).toBe(4)
  })
})
