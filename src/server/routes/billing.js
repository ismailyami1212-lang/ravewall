import { Router } from 'express'
import { billingCheckoutSchema } from '../../shared/validation.js'
import { canManageBilling } from '../access.js'
import { requireUser } from '../auth.js'
import { planForPriceId } from '../billing.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js'
import { asyncHandler, parse, send } from '../http.js'
import { getWorkspaceBilling, setStripeCustomerId } from '../workspaces.js'

const billingUnavailable = () =>
  new AppError(503, 'billing_unavailable', 'Billing is not configured for this deployment.')

/** Absolute origin Stripe should send the customer back to. */
function appBaseUrl(config) {
  if (!config.appUrl) {
    throw new AppError(
      503,
      'billing_unavailable',
      'APP_URL is required to start a billing session.',
    )
  }
  return String(config.appUrl).replace(/\/$/, '')
}

/**
 * Resolves the plan a caller asked for, without ever trusting a raw price id.
 * Accepts either `{ plan }` or `{ priceId }`; if both are present they must
 * describe the same configured plan.
 */
function resolvePlan(config, input) {
  if (input.priceId) {
    const fromPrice = planForPriceId(config, input.priceId)
    if (!fromPrice) throw badRequest('That price is not available.')
    if (input.plan && input.plan !== fromPrice) {
      throw badRequest('The selected plan does not match that price.')
    }
    return fromPrice
  }
  if (!input.plan) throw badRequest('Choose a plan.')
  return input.plan
}

/**
 * Billing routes.
 *
 * Every route requires an active workspace membership with an owner/admin role.
 * A caller cannot choose a Stripe customer, price or workspace id: those are
 * always resolved from the authenticated session and the server configuration.
 *
 * @param {{ db: any, config: any, stripe: any }} deps
 */
export function createBillingRouter({ db, config, stripe }) {
  const router = Router()
  router.use(requireUser)
  router.use((req, _res, next) => {
    if (!req.workspace) return next(notFound('Workspace not found.'))
    next()
  })
  router.use((req, _res, next) => {
    if (!canManageBilling(req.role)) return next(forbidden())
    next()
  })
  router.use((_req, _res, next) => {
    if (!config.billingEnabled || !stripe) return next(billingUnavailable())
    next()
  })

  /**
   * Creates a Stripe Checkout Session for a subscription.
   *
   * `workspace_id` is written to both the session metadata and the resulting
   * subscription metadata, so either webhook event can be matched back to the
   * correct tenant without trusting anything from the browser.
   */
  router.post(
    '/checkout',
    asyncHandler(async (req, res) => {
      const input = parse(billingCheckoutSchema, req.body)
      const plan = resolvePlan(config, input)
      const priceId = config.stripePrices?.[plan]
      if (!priceId) throw badRequest('That plan is not available.')

      const base = appBaseUrl(config)
      const billing = await getWorkspaceBilling(db, req.workspace.id)

      let customerId = billing?.stripeCustomerId ?? null
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: req.user.email,
          name: req.workspace.name,
          metadata: { workspace_id: req.workspace.id },
        })
        customerId = await setStripeCustomerId(db, req.workspace.id, customer.id)
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: req.workspace.id,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        success_url: `${base}/settings?billing=success`,
        cancel_url: `${base}/pricing?billing=cancelled`,
        metadata: { workspace_id: req.workspace.id, plan },
        subscription_data: {
          metadata: { workspace_id: req.workspace.id, plan },
        },
      })

      if (!session.url) {
        throw new AppError(502, 'billing_error', 'Stripe did not return a checkout URL.')
      }
      send(res, { url: session.url })
    }),
  )

  /**
   * Opens the Stripe Customer Portal for payment methods, invoices and
   * cancellation. Requires a customer created by a previous checkout.
   */
  router.post(
    '/portal',
    asyncHandler(async (req, res) => {
      const base = appBaseUrl(config)
      const billing = await getWorkspaceBilling(db, req.workspace.id)
      if (!billing?.stripeCustomerId) {
        throw conflict('Start a subscription before opening the billing portal.')
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: billing.stripeCustomerId,
        return_url: `${base}/settings?billing=portal`,
      })

      if (!session.url) {
        throw new AppError(502, 'billing_error', 'Stripe did not return a portal URL.')
      }
      send(res, { url: session.url })
    }),
  )

  return router
}
