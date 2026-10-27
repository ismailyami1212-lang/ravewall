/**
 * Subscription plans and their entitlements.
 *
 * The database constrains `workspaces.plan` to these ids, so anything read from
 * PostgreSQL is trustworthy. Limits are kept browser-safe because the same
 * values are used by the server for enforcement and, later, by the console to
 * show usage.
 *
 * `null` means unlimited. Projects are unlimited on every plan — the plan
 * boundary is the number of clients a workspace can manage.
 */
export const PLAN_IDS = Object.freeze(['free', 'starter', 'pro', 'agency'])

/** Plans that can be purchased. Free is the default and has no Stripe price. */
export const PAID_PLAN_IDS = Object.freeze(['starter', 'pro', 'agency'])

export const PLAN_LIMITS = Object.freeze({
  free: Object.freeze({ clients: 1, projects: null }),
  starter: Object.freeze({ clients: 3, projects: null }),
  pro: Object.freeze({ clients: 10, projects: null }),
  agency: Object.freeze({ clients: null, projects: null }),
})

/** Display name used in entitlement errors. */
export function planName(plan) {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Free'
}

/** Limits for a known plan. Unknown values fail closed to Free. */
export function planLimits(plan) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}

/** True for a plan id accepted by the database constraint. */
export function isPlan(plan) {
  return PLAN_IDS.includes(plan)
}

/** True for a plan that requires an active paid subscription. */
export function isPaidPlan(plan) {
  return PAID_PLAN_IDS.includes(plan)
}
