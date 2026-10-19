import { Router } from 'express'
import {
  importSchema,
  questionSchema,
  tagSchema,
  testimonialTagsSchema,
  widgetConfigSchema,
  widgetPatchSchema,
} from '../../shared/validation.js'
import { canModerate } from '../access.js'
import { requireUser } from '../auth.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { asyncHandler, parse, send } from '../http.js'
import { requireProjectAccess } from '../workspaces.js'
import {
  createWidget,
  deleteWidget,
  duplicateWidget,
  getWidgetForWorkspace,
  listWorkspaceWidgets,
  mapWidget,
  updateWidget,
  widgetCounts,
} from '../widgets.js'

const mapTag = (row) => ({ id: row.id, name: row.name, createdAt: row.created_at })
const mapQuestion = (row) => ({
  id: row.id,
  projectId: row.project_id,
  label: row.label,
  type: row.type,
  required: row.required,
  position: row.position,
})

/**
 * Project content: tags, custom questions, saved widgets, analytics and CSV.
 * Every route resolves the project through `requireProjectAccess` first.
 */
export function createContentRouter({ db }) {
  const router = Router()
  router.use(requireUser)

  const project = async (req, write = false) =>
    requireProjectAccess(db, req.membership, req.workspace.id, req.params.projectId, { write })

  /* ---------------------------------------------------------------- tags */
  router.get(
    '/tags',
    asyncHandler(async (req, res) => {
      const { rows } = await db.query(
        'SELECT * FROM tags WHERE workspace_id = $1 ORDER BY lower(name)',
        [req.workspace.id],
      )
      send(res, { items: rows.map(mapTag) })
    }),
  )

  router.post(
    '/tags',
    asyncHandler(async (req, res) => {
      if (!canModerate(req.role)) throw forbidden()
      const input = parse(tagSchema, req.body)
      try {
        const { rows } = await db.query(
          'INSERT INTO tags (workspace_id, name) VALUES ($1, $2) RETURNING *',
          [req.workspace.id, input.name],
        )
        send(res, { tag: mapTag(rows[0]) }, 201)
      } catch (error) {
        if (error.code === '23505') throw badRequest('That tag already exists.')
        throw error
      }
    }),
  )

  router.delete(
    '/tags/:id',
    asyncHandler(async (req, res) => {
      if (!canModerate(req.role)) throw forbidden()
      const { rowCount } = await db.query('DELETE FROM tags WHERE id = $1 AND workspace_id = $2', [
        req.params.id,
        req.workspace.id,
      ])
      if (rowCount === 0) throw notFound('Tag not found.')
      res.status(204).end()
    }),
  )

  /* ----------------------------------------------------------- questions */
  router.get(
    '/projects/:projectId/questions',
    asyncHandler(async (req, res) => {
      await project(req)
      const { rows } = await db.query(
        'SELECT * FROM custom_questions WHERE project_id = $1 ORDER BY position, created_at',
        [req.params.projectId],
      )
      send(res, { items: rows.map(mapQuestion) })
    }),
  )

  router.post(
    '/projects/:projectId/questions',
    asyncHandler(async (req, res) => {
      await project(req, true)
      if (!canModerate(req.role)) throw forbidden()
      const input = parse(questionSchema, req.body)
      const { rows: existing } = await db.query(
        'SELECT coalesce(max(position), -1)::int AS max FROM custom_questions WHERE project_id = $1',
        [req.params.projectId],
      )
      const { rows } = await db.query(
        `INSERT INTO custom_questions (project_id, label, type, required, position)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          req.params.projectId,
          input.label,
          input.type,
          input.required,
          input.position ?? existing[0].max + 1,
        ],
      )
      send(res, { question: mapQuestion(rows[0]) }, 201)
    }),
  )

  router.patch(
    '/questions/:id',
    asyncHandler(async (req, res) => {
      const { rows: found } = await db.query(
        `SELECT q.*, p.workspace_id FROM custom_questions q
           JOIN projects p ON p.id = q.project_id
          WHERE q.id = $1`,
        [req.params.id],
      )
      if (!found[0] || found[0].workspace_id !== req.workspace.id) throw notFound('Question not found.')
      await requireProjectAccess(db, req.membership, req.workspace.id, found[0].project_id, { write: true })
      if (!canModerate(req.role)) throw forbidden()
      const input = parse(questionSchema, req.body)
      const { rows } = await db.query(
        'UPDATE custom_questions SET label = $2, type = $3, required = $4, position = $5 WHERE id = $1 RETURNING *',
        [req.params.id, input.label, input.type, input.required, input.position ?? found[0].position],
      )
      send(res, { question: mapQuestion(rows[0]) })
    }),
  )

  router.delete(
    '/questions/:id',
    asyncHandler(async (req, res) => {
      const { rows: found } = await db.query(
        `SELECT q.*, p.workspace_id FROM custom_questions q
           JOIN projects p ON p.id = q.project_id
          WHERE q.id = $1`,
        [req.params.id],
      )
      if (!found[0] || found[0].workspace_id !== req.workspace.id) throw notFound('Question not found.')
      await requireProjectAccess(db, req.membership, req.workspace.id, found[0].project_id, { write: true })
      if (!canModerate(req.role)) throw forbidden()
      await db.query('DELETE FROM custom_questions WHERE id = $1', [req.params.id])
      res.status(204).end()
    }),
  )

  /* ------------------------------------------------------------- widgets */
  /**
   * Loads a widget only if its project's client is in the caller's scope.
   * Writes additionally require `canModerate`. Out-of-scope ids are 404.
   */
  async function widgetFor(req, id) {
    const found = await getWidgetForWorkspace(db, req.workspace.id, id)
    if (!found) throw notFound('Widget not found.')
    await requireProjectAccess(db, req.membership, req.workspace.id, found.projectId)
    return found
  }

  function assertCanWriteWidget(req) {
    if (!canModerate(req.role)) throw forbidden()
  }

  /** Workspace-wide list for the operational Widgets page. */
  router.get(
    '/widgets',
    asyncHandler(async (req, res) => {
      const items = await listWorkspaceWidgets(db, req.workspace.id, req.clientScope)
      send(res, { items })
    }),
  )

  /** Single widget (editor load). */
  router.get(
    '/widgets/:id',
    asyncHandler(async (req, res) => {
      const widget = await widgetFor(req, req.params.id)
      send(res, { widget })
    }),
  )

  router.get(
    '/projects/:projectId/widgets',
    asyncHandler(async (req, res) => {
      await project(req)
      const { rows } = await db.query(
        'SELECT * FROM widget_configs WHERE project_id = $1 ORDER BY created_at ASC',
        [req.params.projectId],
      )
      send(res, { items: rows.map(mapWidget) })
    }),
  )

  router.post(
    '/projects/:projectId/widgets',
    asyncHandler(async (req, res) => {
      await project(req, true)
      assertCanWriteWidget(req)
      const input = parse(widgetConfigSchema, req.body)
      const widget = await createWidget(db, {
        projectId: req.params.projectId,
        name: input.name,
        layout: input.layout,
        theme: input.theme,
        accent: input.accent,
        showStars: input.showStars,
        showCompany: input.showCompany,
        max: input.max,
        minRating: input.minRating,
        tagId: input.tagId,
        status: input.status,
        createdBy: req.user.id,
      })
      send(res, { widget }, 201)
    }),
  )

  router.patch(
    '/widgets/:id',
    asyncHandler(async (req, res) => {
      await widgetFor(req, req.params.id)
      assertCanWriteWidget(req)
      const input = parse(widgetPatchSchema, req.body)
      const widget = await updateWidget(db, req.params.id, input)
      if (!widget) throw notFound('Widget not found.')
      send(res, { widget })
    }),
  )

  /** Copies a widget into a new draft with a fresh public id. */
  router.post(
    '/widgets/:id/duplicate',
    asyncHandler(async (req, res) => {
      await widgetFor(req, req.params.id)
      assertCanWriteWidget(req)
      const widget = await duplicateWidget(db, req.params.id, req.user.id)
      send(res, { widget }, 201)
    }),
  )

  router.delete(
    '/widgets/:id',
    asyncHandler(async (req, res) => {
      await widgetFor(req, req.params.id)
      assertCanWriteWidget(req)
      await deleteWidget(db, req.params.id)
      res.status(204).end()
    }),
  )

  /* ------------------------------------------------------------ analytics */
  router.get(
    '/projects/:projectId/analytics',
    asyncHandler(async (req, res) => {
      const current = await project(req)
      const { rows } = await db.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'pending')::int  AS pending,
                count(*) FILTER (WHERE status = 'approved')::int AS approved,
                count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
                coalesce(round(avg(rating) FILTER (WHERE status = 'approved'), 1), 0) AS average_rating
           FROM testimonials WHERE project_id = $1`,
        [current.id],
      )
      const { rows: trend } = await db.query(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
           FROM testimonials
          WHERE project_id = $1 AND created_at >= now() - interval '30 days'
          GROUP BY 1 ORDER BY 1`,
        [current.id],
      )
      const stats = rows[0]
      send(res, {
        project: { id: current.id, name: current.name, slug: current.slug },
        totals: {
          total: stats.total,
          pending: stats.pending,
          approved: stats.approved,
          rejected: stats.rejected,
          averageRating: Number(stats.average_rating),
          approvalRate:
            stats.approved + stats.rejected > 0
              ? Math.round((stats.approved / (stats.approved + stats.rejected)) * 100)
              : null,
        },
        trend,
      })
    }),
  )

  router.get(
    '/analytics',
    asyncHandler(async (req, res) => {
      const params = [req.workspace.id]
      let scope = ''
      if (req.clientScope !== null) {
        if (req.clientScope.length === 0) {
          send(res, {
            clients: 0,
            projects: 0,
            testimonials: 0,
            thisMonth: 0,
            pending: 0,
            approved: 0,
            widgets: { total: 0, live: 0, draft: 0, archived: 0 },
            topClients: [],
            trend: [],
          })
          return
        }
        params.push(req.clientScope)
        scope = ` AND b.id = ANY($${params.length}::uuid[])`
      }
      const { rows } = await db.query(
        `SELECT count(DISTINCT b.id)::int AS clients,
                count(DISTINCT p.id)::int AS projects,
                count(t.id)::int AS total,
                count(t.id) FILTER (WHERE t.created_at >= date_trunc('month', now()))::int AS this_month,
                count(t.id) FILTER (WHERE t.status = 'pending')::int AS pending,
                count(t.id) FILTER (WHERE t.status = 'approved')::int AS approved
           FROM businesses b
           LEFT JOIN projects p ON p.business_id = b.id
           LEFT JOIN testimonials t ON t.project_id = p.id
          WHERE b.workspace_id = $1${scope}`,
        params,
      )
      const { rows: top } = await db.query(
        `SELECT b.id, b.name, b.accent_color,
                count(t.id) FILTER (WHERE t.status = 'approved')::int AS approved,
                count(t.id) FILTER (WHERE t.status = 'pending')::int AS pending
           FROM businesses b
           LEFT JOIN testimonials t ON t.business_id = b.id
          WHERE b.workspace_id = $1${scope}
          GROUP BY b.id, b.name, b.accent_color
          ORDER BY approved DESC, b.created_at ASC
          LIMIT 5`,
        params,
      )
      const { rows: trend } = await db.query(
        `SELECT to_char(date_trunc('day', t.created_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
           FROM testimonials t
           JOIN businesses b ON b.id = t.business_id
          WHERE b.workspace_id = $1${scope} AND t.created_at >= now() - interval '30 days'
          GROUP BY 1 ORDER BY 1`,
        params,
      )
      send(res, {
        clients: rows[0].clients,
        projects: rows[0].projects,
        testimonials: rows[0].total,
        thisMonth: rows[0].this_month,
        pending: rows[0].pending,
        approved: rows[0].approved,
        widgets: await widgetCounts(db, req.workspace.id, req.clientScope),
        topClients: top.map((row) => ({
          id: row.id,
          name: row.name,
          accentColor: row.accent_color,
          approved: row.approved,
          pending: row.pending,
        })),
        trend,
      })
    }),
  )

  /* ----------------------------------------------------------------- CSV */
  router.get(
    '/projects/:projectId/export.csv',
    asyncHandler(async (req, res) => {
      const current = await project(req)
      const { rows } = await db.query(
        `SELECT t.id, t.author_name, t.company, t.rating, t.status, t.created_at, t.approved_at, t.content,
                coalesce(string_agg(g.name, '|' ORDER BY g.name), '') AS tags
           FROM testimonials t
           LEFT JOIN testimonial_tags tt ON tt.testimonial_id = t.id
           LEFT JOIN tags g ON g.id = tt.tag_id
          WHERE t.project_id = $1
          GROUP BY t.id
          ORDER BY t.created_at DESC`,
        [current.id],
      )
      const escape = (value) => {
        const text = value === null || value === undefined ? '' : String(value)
        return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
      }
      const lines = [
        'name,company,rating,status,created_at,approved_at,content,tags',
        ...rows.map((row) =>
          [
            row.author_name,
            row.company,
            row.rating,
            row.status,
            row.created_at?.toISOString?.() ?? row.created_at,
            row.approved_at?.toISOString?.() ?? '',
            row.content,
            row.tags,
          ]
            .map(escape)
            .join(','),
        ),
      ]
      res.set('Content-Type', 'text/csv; charset=utf-8')
      res.set('Content-Disposition', `attachment; filename="${current.slug}-testimonials.csv"`)
      res.send(lines.join('\n'))
    }),
  )

  router.post(
    '/projects/:projectId/import',
    asyncHandler(async (req, res) => {
      const current = await project(req, true)
      if (!canModerate(req.role)) throw forbidden()
      const input = parse(importSchema, req.body)

      const errors = []
      const valid = []
      const seen = new Set()
      input.rows.forEach((row, index) => {
        const name = String(row.name ?? '').trim()
        const text = String(row.text ?? row.content ?? '').trim()
        const rating = Number.parseInt(String(row.rating ?? ''), 10)
        const problems = []
        if (name.length < 1 || name.length > 60) problems.push('name must be 1–60 characters')
        if (text.length < 10 || text.length > 1000) problems.push('text must be 10–1000 characters')
        if (!Number.isFinite(rating) || rating < 1 || rating > 5) problems.push('rating must be 1–5')
        const key = `${name.toLowerCase()}|${text.toLowerCase()}`
        if (seen.has(key)) problems.push('duplicate of an earlier row')
        if (problems.length > 0) {
          errors.push({ row: index + 1, problems })
          return
        }
        seen.add(key)
        valid.push({
          name,
          company: String(row.company ?? '').slice(0, 80),
          rating,
          text,
          status: row.status === 'approved' ? 'approved' : 'pending',
        })
      })

      if (!input.commit) {
        send(res, { preview: valid.slice(0, 20), total: valid.length, errors, committed: false })
        return
      }
      if (errors.length > 0) {
        throw badRequest('Fix the highlighted rows before importing.', { rows: String(errors.length) })
      }
      if (valid.length === 0) throw badRequest('Nothing to import.')

      const inserted = await db.transaction(async (client) => {
        let count = 0
        for (const row of valid) {
          await client.query(
            `INSERT INTO testimonials
               (business_id, project_id, author_name, company, rating, content, status, source, approved_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'import',$8)`,
            [
              current.clientId,
              current.id,
              row.name,
              row.company,
              row.rating,
              row.text,
              row.status,
              row.status === 'approved' ? new Date() : null,
            ],
          )
          count += 1
        }
        return count
      })
      send(res, { committed: true, imported: inserted, errors: [] }, 201)
    }),
  )

  return router
}
