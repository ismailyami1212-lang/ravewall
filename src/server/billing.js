/**
 * Stripe client construction and plan mapping.
 *
 * Price ids are the authority for a paid plan: metadata is only a fallback for
 * events created before the price was added to configuration. A caller is never
 * allowed to choose a price id directly — checkout accepts a plan name and the
 * server maps it to the configured price.
 */
import Stripe from 'stripe'
import { PAID_PLAN_IDS, isPaidPlan } from '../shared/plans.js'

/**
 * Creates the API client only when the full Stripe configuration is present.
 * Construction is offline, so this is safe to call while building the app.
 */
export function createStripeClient(config) {
  if (!config.billingEnabled) return null
  return new Stripe(config.stripeSecretKey, {
    maxNetworkRetries: 2,
    timeout: 15_000,
  })
}

/** Maps a configured Stripe price id back to a plan, or null. */
export function planForPriceId(config, priceId) {
  if (!priceId) return null
  for (const plan of PAID_PLAN_IDS) {
    if (config.stripePrices?.[plan] === priceId) return plan
  }
  return null
}

/** Stripe object references are either an id string or an expanded object. */
export function objectId(value) {
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id
  return null
}

/**
 * Finds the paid plan represented by a subscription.
 *
 * The first configured price wins (RaveWall sells one price per plan). If the
 * price is not recognised — for example after a price rotation — fall back to
 * the metadata written at checkout so a paying customer is not downgraded.
 */
export function planForSubscription(config, subscription) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : []
  for (const item of items) {
    const plan = planForPriceId(config, objectId(item?.price))
    if (plan) return plan
  }

  const metadataPlan = subscription?.metadata?.plan
  return isPaidPlan(metadataPlan) ? metadataPlan : null
}

/** Stripe statuses that should receive paid-plan entitlements. */
export function isEntitledStatus(status) {
  return status === 'active' || status === 'trialing'
}

/** Plan to persist for an event, never allowing an unknown status to upgrade. */
export function planForStatus(status, paidPlan) {
  if (!isEntitledStatus(status)) return 'free'
  return isPaidPlan(paidPlan) ? paidPlan : 'free'
}
