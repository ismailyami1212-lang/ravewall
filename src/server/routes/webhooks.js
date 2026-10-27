import { Router } from 'express'
import { isPaidPlan } from '../../shared/plans.js'
import { objectId, planForStatus, planForSubscription } from '../billing.js'
import { AppError, badRequest } from '../errors.js'
import { asyncHandler } from '../http.js'
import {
  findWorkspaceByStripeIds,
  getWorkspaceBilling,
  syncStripeSubscription,
} from '../workspaces.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Only accept workspace ids that can safely be compared with a uuid column. */
function workspaceIdFromMetadata(metadata) {
  const value = metadata?.workspace_id
  return typeof value === 'string' && UUID.test(value) ? value : null
}

/**
 * Finds the tenant for an event. Metadata is preferred because it is written by
 * our checkout route; the stored ids are a fallback for events that arrive
 * before the checkout completion (or from the Customer Portal).
 */
async function resolveWorkspaceId(db, { metadata, customerId, subscriptionId }) {
  return (
    workspaceIdFromMetadata(metadata) ??
    (await findWorkspaceByStripeIds(db, { customerId, subscriptionId }))
  )
}

/** `checkout.session.completed` — persist the customer, subscription and plan. */
async function handleCheckoutCompleted(db, config, stripe, session) {
  const customerId = objectId(session.customer)
  const subscriptionId = objectId(session.subscription)
  const workspaceId = await resolveWorkspaceId(db, {
    metadata: session.metadata,
    customerId,
    subscriptionId,
  })
  if (!workspaceId) return

  // The session only identifies the subscription. Retrieving it makes the plan
  // and status authoritative even if metadata was tampered with or an older
  // checkout session is replayed. Fakes and older clients that only implement
  // signature verification can omit `subscriptions.retrieve`; the signed
  // metadata written by our checkout route is the safe fallback.
  const subscription =
    subscriptionId && typeof stripe.subscriptions?.retrieve === 'function'
      ? await stripe.subscriptions.retrieve(subscriptionId)
      : null
  const status = subscription?.status ?? 'active'
  const metadataPlan = isPaidPlan(session.metadata?.plan) ? session.metadata.plan : null
  const paidPlan = (subscription && planForSubscription(config, subscription)) ?? metadataPlan

  await syncStripeSubscription(db, {
    workspaceId,
    plan: planForStatus(status, paidPlan),
    customerId,
    subscriptionId,
    status,
  })
}

/** `customer.subscription.updated` / `customer.subscription.deleted`. */
async function handleSubscriptionChange(db, config, subscription, { deleted = false } = {}) {
  const customerId = objectId(subscription.customer)
  const subscriptionId = objectId(subscription.id)
  const workspaceId = await resolveWorkspaceId(db, {
    metadata: subscription.metadata,
    customerId,
    subscriptionId,
  })
  if (!workspaceId) return

  const existing = await getWorkspaceBilling(db, workspaceId)
  const mappedPlan = planForSubscription(config, subscription)
  // If a price rotation made the price unrecognisable, keep a paid workspace on
  // its current plan while the subscription is still active. Never invent a
  // paid plan for a workspace that was not already on one.
  const fallbackPlan =
    mappedPlan ?? (existing && isPaidPlan(existing.plan) ? existing.plan : 'free')
  const status = deleted ? 'canceled' : subscription.status ?? null
  const plan = deleted ? 'free' : planForStatus(status, fallbackPlan)

  await syncStripeSubscription(db, {
    workspaceId,
    plan,
    customerId,
    subscriptionId,
    status,
  })
}

/**
 * Stripe webhooks.
 *
 * The raw request body is captured by `express.json`'s verify hook in app.js;
 * signature verification must happen before any event data is trusted. Unknown
 * event types are acknowledged with 200 so Stripe does not retry them forever.
 *
 * @param {{ db: any, config: any, stripe: any }} deps
 */
export function createWebhookRouter({ db, config, stripe }) {
  const router = Router()

  router.post(
    '/stripe',
    asyncHandler(async (req, res) => {
      if (!config.billingEnabled || !stripe) {
        throw new AppError(503, 'billing_unavailable', 'Billing is not configured for this deployment.')
      }

      const signature = req.get('stripe-signature')
      if (!signature) throw badRequest('Missing Stripe signature.')
      if (!Buffer.isBuffer(req.rawBody) && typeof req.rawBody !== 'string') {
        throw badRequest('Stripe webhook body is unavailable.')
      }

      let event
      try {
        event = stripe.webhooks.constructEvent(
          req.rawBody,
          signature,
          config.stripeWebhookSecret,
        )
      } catch {
        // Never echo the signature or the secret. A bad signature is a 400, not
        // a server error, and no event is processed.
        throw badRequest('Invalid Stripe webhook signature.')
      }

      if (event.type === 'checkout.session.completed') {
        await handleCheckoutCompleted(db, config, stripe, event.data.object)
      } else if (event.type === 'customer.subscription.updated') {
        await handleSubscriptionChange(db, config, event.data.object)
      } else if (event.type === 'customer.subscription.deleted') {
        await handleSubscriptionChange(db, config, event.data.object, { deleted: true })
      }

      res.json({ received: true })
    }),
  )

  return router
}
