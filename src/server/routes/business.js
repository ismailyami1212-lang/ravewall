import { Router } from 'express'
import { businessSetupSchema, businessUpdateSchema, slugSchema } from '../../shared/validation.js'
import { planLimits } from '../../shared/plans.js'
import { canManageClients } from '../access.js'
import { requireUser } from '../auth.js'
import { conflict, forbidden } from '../errors.js'
import { asyncHandler, parse, send } from '../http.js'
import { createClient, updateClient } from '../workspaces.js'
import { isSlugTaken, publicBusiness, updateBusiness } from '../repositories.js'

/**
 * Business profile endpoints. Every handler is scoped to the signed-in user's
 * own business — the business id is never accepted from the request.
 * @param {{ db: any }} deps
 */
export function createBusinessRouter({ db }) {
  const router = Router()
  router.use(requireUser)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      send(res, { business: publicBusiness(req.business) })
    }),
  )

  /** Live availability check for the setup form. */
  router.get(
    '/slug-available',
    asyncHandler(async (req, res) => {
      const slug = parse(slugSchema, req.query.slug)
      send(res, { slug, available: !(await isSlugTaken(db, slug)) })
    }),
  )

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      if (req.business) {
        throw conflict('This account already has a business profile.')
      }
      if (!req.workspace) {
        throw conflict('Create a workspace first.')
      }
      if (!canManageClients(req.role)) throw forbidden()
      const input = parse(businessSetupSchema, req.body)
      // The unique index is the real guard; this is only a friendlier message.
      if (await isSlugTaken(db, input.slug)) {
        throw conflict('That link name is already taken.', {
          slug: 'That link name is taken. Try another one.',
        })
      }
      const limits = planLimits(req.workspace.plan)
      // Creating a client also creates its default project, so the collection
      // link and wall work immediately.
      const business = await createClient(db, {
        workspaceId: req.workspace.id,
        ownerUserId: req.user.id,
        ...input,
        maxClients: limits.clients,
        plan: req.workspace.plan,
      })
      send(res, { business: publicBusiness(business) }, 201)
    }),
  )

  router.patch(
    '/',
    asyncHandler(async (req, res) => {
      if (!req.business) {
        throw conflict('Create your business profile first.')
      }
      const patch = parse(businessUpdateSchema, req.body)
      const business = await updateBusiness(db, req.actor, req.business.id, patch)
      send(res, { business: publicBusiness(business) })
    }),
  )

  return router
}
