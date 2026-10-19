import { Router } from 'express'
import {
  memberClientsSchema,
  memberSchema,
  memberUpdateSchema,
  projectSchema,
  projectUpdateSchema,
  workspaceUpdateSchema,
} from '../../shared/validation.js'
import { canManageClients, canManageTeam, canModerate, isUnscoped } from '../access.js'
import { requireUser } from '../auth.js'
import { forbidden, notFound, badRequest, conflict } from '../errors.js'
import { asyncHandler, parse, send } from '../http.js'
import { findUserByEmail, publicBusiness } from '../repositories.js'
import {
  addMember,
  countClients,
  countOwners,
  createClient,
  createProject,
  deleteClient,
  deleteProject,
  getClientById,
  listClients,
  listMemberClientIds,
  listProjects,
  listTeam,
  removeMember,
  renameWorkspace,
  requireClientAccess,
  requireProjectAccess,
  setMemberClients,
  updateClient,
  updateMemberRole,
  updateProject,
} from '../workspaces.js'

/**
 * Workspace surface: the client list, the projects inside each client, and
 * the team that can see them.
 *
 * Every handler resolves the client/project through `requireClientAccess` /
 * `requireProjectAccess`, which 404 on anything outside the caller's scope.
 */
export function createWorkspaceRouter({ db }) {
  const router = Router()
  router.use(requireUser)

  /** Every workspace route needs a resolvable, in-scope workspace.
   *  A caller who passes an unknown `x-workspace-id` (or none at all) gets a
   *  404, never a 500 from a null dereference — and never a hint that the id
   *  exists. */
  router.use(requireWorkspace)

  /** Current workspace, role and a few counts for the console header. */
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      if (!req.workspace) throw notFound('Workspace not found.')
      const clients = await listClients(db, req.workspace.id, req.clientScope)
      const projects = await listProjects(db, req.workspace.id, req.clientScope)
      send(res, {
        workspace: req.workspace,
        role: req.role,
        memberships: req.memberships,
        counts: { clients: clients.length, projects: projects.length },
      })
    }),
  )

  router.patch(
    '/',
    asyncHandler(async (req, res) => {
      if (!canManageClients(req.role)) throw forbidden()
      const input = parse(workspaceUpdateSchema, req.body)
      const workspace = await renameWorkspace(db, req.workspace.id, input.name)
      send(res, { workspace })
    }),
  )

  /* ------------------------------------------------------------- clients */
  router.get(
    '/clients',
    asyncHandler(async (req, res) => {
      const clients = await listClients(db, req.workspace.id, req.clientScope)
      send(res, { items: clients.map(publicBusiness) })
    }),
  )

  /**
   * Per-client operational counts for the Clients page. One grouped query
   * rather than N round trips; scoped exactly like the client list.
   */
  router.get(
    '/clients/summary',
    asyncHandler(async (req, res) => {
      const params = [req.workspace.id]
      let scope = ''
      if (req.clientScope !== null) {
        if (req.clientScope.length === 0) {
          send(res, { items: [] })
          return
        }
        params.push(req.clientScope)
        scope = ` AND b.id = ANY($${params.length}::uuid[])`
      }
      const { rows } = await db.query(
        `SELECT b.id,
                count(DISTINCT p.id)::int AS projects,
                count(DISTINCT t.id)::int AS testimonials,
                count(DISTINCT t.id) FILTER (WHERE t.status = 'pending')::int  AS pending,
                count(DISTINCT t.id) FILTER (WHERE t.status = 'approved')::int AS approved,
                count(DISTINCT w.id)::int AS widgets,
                count(DISTINCT w.id) FILTER (WHERE w.status = 'live')::int AS live_widgets
           FROM businesses b
           LEFT JOIN projects p       ON p.business_id = b.id
           LEFT JOIN testimonials t   ON t.project_id = p.id
           LEFT JOIN widget_configs w ON w.project_id = p.id
          WHERE b.workspace_id = $1${scope}
          GROUP BY b.id`,
        params,
      )
      send(res, {
        items: rows.map((row) => ({
          id: row.id,
          projects: row.projects,
          testimonials: row.testimonials,
          pending: row.pending,
          approved: row.approved,
          widgets: row.widgets,
          liveWidgets: row.live_widgets,
        })),
      })
    }),
  )

  router.post(
    '/clients',
    asyncHandler(async (req, res) => {
      if (!canManageClients(req.role)) throw forbidden()
      const input = parse(projectSchema.extend({}), req.body)
      const business = await createClient(db, {
        workspaceId: req.workspace.id,
        ownerUserId: req.user.id,
        name: input.name,
        slug: input.slug ?? slugify(input.name),
        accentColor: '#15803d',
      })
      send(res, { client: publicBusiness(business) }, 201)
    }),
  )

  router.patch(
    '/clients/:id',
    asyncHandler(async (req, res) => {
      const client = await requireClientAccess(db, req.membership, req.workspace.id, req.params.id, {
        write: true,
      })
      if (!canManageClients(req.role) && !canModerate(req.role)) throw forbidden()
      const input = parse(projectUpdateSchema, req.body)
      const updated = await updateClient(db, client.id, input)
      send(res, { client: publicBusiness(updated) })
    }),
  )

  router.delete(
    '/clients/:id',
    asyncHandler(async (req, res) => {
      if (!canManageClients(req.role)) throw forbidden()
      const client = await requireClientAccess(db, req.membership, req.workspace.id, req.params.id, {
        write: true,
      })
      const remaining = await countClients(db, req.workspace.id)
      if (remaining <= 1) {
        throw conflict('Keep at least one client in the workspace.')
      }
      await deleteClient(db, client.id)
      res.status(204).end()
    }),
  )

  /* ------------------------------------------------------------ projects */
  router.get(
    '/projects',
    asyncHandler(async (req, res) => {
      const projects = await listProjects(db, req.workspace.id, req.clientScope)
      send(res, { items: projects })
    }),
  )

  /** Per-project counts for the client overview and project lists. */
  router.get(
    '/projects/summary',
    asyncHandler(async (req, res) => {
      const params = [req.workspace.id]
      let scope = ''
      if (req.clientScope !== null) {
        if (req.clientScope.length === 0) {
          send(res, { items: [] })
          return
        }
        params.push(req.clientScope)
        scope = ` AND p.business_id = ANY($${params.length}::uuid[])`
      }
      const { rows } = await db.query(
        `SELECT p.id,
                count(DISTINCT t.id)::int AS testimonials,
                count(DISTINCT t.id) FILTER (WHERE t.status = 'pending')::int  AS pending,
                count(DISTINCT t.id) FILTER (WHERE t.status = 'approved')::int AS approved,
                count(DISTINCT w.id)::int AS widgets,
                count(DISTINCT w.id) FILTER (WHERE w.status = 'live')::int AS live_widgets
           FROM projects p
           LEFT JOIN testimonials t   ON t.project_id = p.id
           LEFT JOIN widget_configs w ON w.project_id = p.id
          WHERE p.workspace_id = $1${scope}
          GROUP BY p.id`,
        params,
      )
      send(res, {
        items: rows.map((row) => ({
          id: row.id,
          testimonials: row.testimonials,
          pending: row.pending,
          approved: row.approved,
          widgets: row.widgets,
          liveWidgets: row.live_widgets,
        })),
      })
    }),
  )

  router.post(
    '/clients/:id/projects',
    asyncHandler(async (req, res) => {
      const client = await requireClientAccess(db, req.membership, req.workspace.id, req.params.id, {
        write: true,
      })
      if (!canModerate(req.role)) throw forbidden()
      const input = parse(projectSchema, req.body)
      const project = await createProject(db, {
        workspaceId: req.workspace.id,
        clientId: client.id,
        name: input.name,
        slug: input.slug ?? slugify(`${client.slug}-${input.name}`),
      })
      send(res, { project }, 201)
    }),
  )

  router.patch(
    '/projects/:id',
    asyncHandler(async (req, res) => {
      const project = await requireProjectAccess(db, req.membership, req.workspace.id, req.params.id, {
        write: true,
      })
      const input = parse(projectUpdateSchema, req.body)
      const updated = await updateProject(db, project.id, input)
      send(res, { project: updated })
    }),
  )

  router.delete(
    '/projects/:id',
    asyncHandler(async (req, res) => {
      const project = await requireProjectAccess(db, req.membership, req.workspace.id, req.params.id, {
        write: true,
      })
      await deleteProject(db, project.id)
      res.status(204).end()
    }),
  )

  /* ---------------------------------------------------------------- team */
  router.get(
    '/team',
    asyncHandler(async (req, res) => {
      const members = await listTeam(db, req.workspace.id)
      const clients = await listClients(db, req.workspace.id, req.clientScope)
      send(res, { items: members, clients: clients.map((client) => ({ id: client.id, name: client.name })) })
    }),
  )

  router.post(
    '/team',
    asyncHandler(async (req, res) => {
      if (!canManageTeam(req.role)) throw forbidden()
      const input = parse(memberSchema, req.body)
      const user = await findUserByEmail(db, input.email)
      if (!user) {
        // Invitations need an email provider that is not configured yet; the
        // honest answer is that the person needs an account first.
        throw badRequest('That email does not have a RaveWall account yet.', {
          email: 'Ask them to create a free account, then add them here.',
        })
      }
      const member = await addMember(db, req.workspace.id, user.id, input.role)
      send(res, { member: { ...member, name: user.name, email: user.email } }, 201)
    }),
  )

  router.patch(
    '/team/:userId',
    asyncHandler(async (req, res) => {
      if (!canManageTeam(req.role)) throw forbidden()
      const input = parse(memberUpdateSchema, req.body)
      if (req.params.userId === req.user.id && input.role !== 'owner') {
        throw conflict('You cannot change your own owner role.')
      }
      if (input.role !== 'owner') {
        const owners = await countOwners(db, req.workspace.id)
        const current = (await listTeam(db, req.workspace.id)).find((m) => m.userId === req.params.userId)
        if (current?.role === 'owner' && owners <= 1) {
          throw conflict('A workspace needs at least one owner.')
        }
      }
      const member = await updateMemberRole(db, req.workspace.id, req.params.userId, input.role)
      if (!member) throw notFound('Member not found.')
      send(res, { member })
    }),
  )

  router.delete(
    '/team/:userId',
    asyncHandler(async (req, res) => {
      if (!canManageTeam(req.role)) throw forbidden()
      if (req.params.userId === req.user.id) throw conflict('You cannot remove yourself.')
      const current = (await listTeam(db, req.workspace.id)).find((m) => m.userId === req.params.userId)
      if (!current) throw notFound('Member not found.')
      if (current.role === 'owner') {
        const owners = await countOwners(db, req.workspace.id)
        if (owners <= 1) throw conflict('A workspace needs at least one owner.')
      }
      await removeMember(db, req.workspace.id, req.params.userId)
      res.status(204).end()
    }),
  )

  router.put(
    '/team/:userId/clients',
    asyncHandler(async (req, res) => {
      if (!canManageTeam(req.role)) throw forbidden()
      const input = parse(memberClientsSchema, req.body)
      const member = (await listTeam(db, req.workspace.id)).find((m) => m.userId === req.params.userId)
      if (!member) throw notFound('Member not found.')
      if (isUnscoped(member.role)) {
        throw conflict('Owners and admins already see every client.')
      }
      await setMemberClients(db, req.workspace.id, req.params.userId, input.clientIds)
      send(res, { clientIds: input.clientIds })
    }),
  )

  /* ------------------------------------------------------------- helpers */
  router.get(
    '/clients/:id',
    asyncHandler(async (req, res) => {
      const client = await requireClientAccess(db, req.membership, req.workspace.id, req.params.id)
      const projects = (await listProjects(db, req.workspace.id, req.clientScope)).filter(
        (project) => project.clientId === client.id,
      )
      send(res, { client: publicBusiness(client), projects })
    }),
  )

  return router
}

/** Every workspace route needs a resolvable, in-scope workspace.
 *  A caller who passes an unknown `x-workspace-id` (or none) gets a 404, never a
 *  500, and never a hint that the id exists. */
export function requireWorkspace(req, _res, next) {
  if (!req.workspace) return next(notFound('Workspace not found.'))
  next()
}

/** Slug helper shared with the project routes. */
export function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

/** Re-exported so the router module has no hidden dependency on client scope. */
export { getClientById, listMemberClientIds }
