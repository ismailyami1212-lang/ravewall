/**
 * Authorisation policy layer.
 *
 * This is the app's equivalent of Postgres row-level security: every read and
 * write of a scoped row goes through one of these predicates, and the
 * repositories never build a query from client supplied identity. Business and
 * testimonial rows carry an owner, and a caller may only touch rows the policy
 * admits.
 *
 * Two rules are deliberately enforced here and nowhere else:
 *   1. A visitor (anonymous actor) may only ever see APPROVED testimonials.
 *   2. Only the owner of a business may read its moderation queue or change a
 *      testimonial's status.
 */
import { PUBLIC_STATUS } from '../shared/constants.js'

/** @typedef {{ kind: 'anonymous', userId: null } | { kind: 'user', userId: string }} Actor */

/** @type {Actor} */
export const ANONYMOUS = Object.freeze({ kind: 'anonymous', userId: null })

/**
 * @param {{ id: string }} user
 * @returns {Actor}
 */
export function userActor(user) {
  return { kind: 'user', userId: user.id }
}

export function isAuthenticated(actor) {
  return Boolean(actor && actor.kind === 'user' && actor.userId)
}

/**
 * SELECT policy for `businesses`: a business row is visible to its owner, or to
 * anyone when addressed through its public slug (the public projection is
 * applied by the caller, which exposes only display fields).
 * @param {Actor} actor
 * @param {{ ownerId: string } | null | undefined} business
 */
export function ownsBusiness(actor, business) {
  return Boolean(isAuthenticated(actor) && business && business.ownerId === actor.userId)
}

/**
 * SELECT policy for `testimonials`: approved rows are world readable, everything
 * else is visible only to the business owner.
 * @param {Actor} actor
 * @param {{ status: string, businessId: string }} testimonial
 * @param {{ ownerId: string } | null | undefined} business
 */
export function canReadTestimonial(actor, testimonial, business) {
  if (testimonial.status === PUBLIC_STATUS) return true
  return ownsBusiness(actor, business)
}

/**
 * UPDATE / DELETE policy for `testimonials`.
 * @param {Actor} actor
 * @param {{ businessId: string }} testimonial
 * @param {{ id: string, ownerId: string } | null | undefined} business
 */
export function canModifyTestimonial(actor, testimonial, business) {
  if (!business) return false
  if (testimonial.businessId !== business.id) return false
  return ownsBusiness(actor, business)
}

/**
 * Filters a list of rows through the SELECT policy.
 * @param {Actor} actor
 * @param {Array<{ status: string }>} testimonials
 * @param {{ ownerId: string } | null | undefined} business
 */
export function visibleTestimonials(actor, testimonials, business) {
  return testimonials.filter((row) => canReadTestimonial(actor, row, business))
}
