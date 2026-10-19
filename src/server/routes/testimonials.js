import { Router } from 'express'
import { listQuerySchema, moderationSchema } from '../../shared/validation.js'
import { requireUser } from '../auth.js'
import { AppError, badRequest, notFound } from '../errors.js'
import { asyncHandler, parse, send } from '../http.js'
import { requireWorkspace } from './workspace.js'
import { requireClientAccess, requireProjectAccess } from '../workspaces.js'
import {
  businessStats,
  deleteTestimonialById,
  getTestimonialWithProject,
  listTestimonials,
  publicTestimonial,
  setTestimonialStatusById,
} from '../repositories.js'

/**
 * Owner-side testimonial management: the moderation inbox.
 *
 * By default it scopes to the active workspace's primary client. A `clientId`
 * query parameter scopes the inbox to any client the member may see, and an
 * optional `projectId` narrows it further to a single project — this is what
 * makes the agency console's per-client, per-project moderation work without a
 * separate code path.
 *
 * Authorisation is workspace-based: a write resolves the testimonial's own
 * client, then requires the caller to be a member of the workspace in whose
 * scope that client falls, with a role that may moderate. This is what lets an
 * admin or manager moderate a client they do not personally own, while a
 * non-member (or a manager scoped to other clients) still gets a 404.
 * @param {{ db: any }} deps
 */
export function createTestimonialRouter({ db }) {
  const router = Router()
  router.use(requireUser, requireWorkspace)

  /** Resolves the business (client) the inbox should operate on. */
  async function resolveBusiness(req) {
    if (req.query.clientId) {
      const client = await requireClientAccess(db, req.membership, req.workspace.id, String(req.query.clientId))
      return client
    }
    return req.business
  }

  /**
   * Authorises a write against the testimonial's *own* client. Returns the
   * testimonial with its client id. Out-of-workspace, out-of-scope and
   * read-only callers all get a 404, never a hint that the row exists.
   */
  async function authorizeWrite(req, testimonialId) {
    const found = await getTestimonialWithProject(db, testimonialId)
    if (!found || found.workspaceId !== req.workspace.id) {
      throw notFound('Testimonial not found.')
    }
    await requireClientAccess(db, req.membership, req.workspace.id, found.testimonial.businessId, {
      write: true,
    })
    return found
  }

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const query = parse(listQuerySchema, req.query)
      const business = await resolveBusiness(req)
      if (!business) throw new AppError(409, 'business_setup_required', 'Select a client to continue.')

      let projectId = null
      if (req.query.projectId) {
        const project = await requireProjectAccess(db, req.membership, req.workspace.id, String(req.query.projectId))
        projectId = project.id
      }

      // `trusted`: the client was resolved through the workspace membership and
      // client scope above, so the SQL already bounds every row to it.
      const items = await listTestimonials(db, req.actor, business, query, projectId, { trusted: true })
      send(res, {
        items: items.map(publicTestimonial),
        stats: await businessStats(db, business.id, projectId),
      })
    }),
  )

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const { status } = parse(moderationSchema, req.body)
      const found = await authorizeWrite(req, req.params.id)
      const updated = await setTestimonialStatusById(db, req.params.id, status)
      send(res, {
        testimonial: publicTestimonial(updated),
        stats: await businessStats(db, found.testimonial.businessId),
      })
    }),
  )

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const found = await authorizeWrite(req, req.params.id)
      const removed = await deleteTestimonialById(db, req.params.id)
      send(res, {
        id: removed.id,
        stats: await businessStats(db, found.testimonial.businessId),
      })
    }),
  )

  return router
}
