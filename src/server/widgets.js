/**
 * Saved widget data access.
 *
 * A saved widget is a first-class, project-scoped display configuration with a
 * stable `public_id` used by embed snippets, a publication `status`, and an
 * optional author. Unlike the legacy slug-based widget endpoint (which renders
 * whatever `data-rw-*` attributes a host wrote), a saved widget can be edited
 * in place and every embed referencing it picks up the change.
 *
 * Every function here is scoped by workspace and by the caller's client scope;
 * the routes additionally check `canModerate` before any write.
 */
import { randomBytes } from 'node:crypto'
import { notFound } from './errors.js'

export const WIDGET_STATUSES = ['draft', 'live', 'archived']

/** Opaque, URL-safe identifier used in embed snippets. */
export function newPublicId() {
  return randomBytes(12).toString('hex')
}

const toIso = (value) => (value instanceof Date ? value.toISOString() : value ?? null)

export function mapWidget(row) {
  if (!row) return null
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    layout: row.layout,
    theme: row.theme,
    accent: row.accent,
    showStars: row.show_stars,
    showCompany: row.show_company,
    max: row.max_items,
    minRating: row.min_rating,
    tagId: row.tag_id,
    publicId: row.public_id,
    status: row.status,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

/** Widget plus the client/project it belongs to (for the operational list). */
function mapWidgetWithContext(row) {
  return {
    ...mapWidget(row),
    clientId: row.client_id,
    clientName: row.client_name,
    clientSlug: row.client_slug,
    projectName: row.project_name,
  }
}

const CONTEXT_SELECT = `
  SELECT w.*,
         p.business_id AS client_id,
         p.name        AS project_name,
         b.name        AS client_name,
         b.slug        AS client_slug
    FROM widget_configs w
    JOIN projects   p ON p.id = w.project_id
    JOIN businesses b ON b.id = p.business_id`

/**
 * Every widget in the workspace the caller may see, newest edit first.
 * @param {string[] | null} allowedClientIds null means "all clients"
 */
export async function listWorkspaceWidgets(db, workspaceId, allowedClientIds) {
  const params = [workspaceId]
  let scope = ''
  if (allowedClientIds !== null) {
    if (allowedClientIds.length === 0) return []
    params.push(allowedClientIds)
    scope = ` AND p.business_id = ANY($${params.length}::uuid[])`
  }
  const { rows } = await db.query(
    `${CONTEXT_SELECT}
      WHERE p.workspace_id = $1${scope}
      ORDER BY w.updated_at DESC`,
    params,
  )
  return rows.map(mapWidgetWithContext)
}

/**
 * Loads a widget only if its project belongs to `workspaceId`.
 * Returns null otherwise so the route can 404 without leaking existence.
 */
export async function getWidgetForWorkspace(db, workspaceId, id) {
  const { rows } = await db.query(
    `${CONTEXT_SELECT}
      WHERE w.id = $1 AND p.workspace_id = $2`,
    [id, workspaceId],
  )
  return rows[0] ? mapWidgetWithContext(rows[0]) : null
}

/**
 * Public lookup by the stable embed id. Returns the widget, its project and the
 * owning client id; the caller projects the business to public fields.
 */
export async function getPublicWidget(db, publicId) {
  const { rows } = await db.query(
    `SELECT w.*, p.id AS project_id_ref, p.name AS project_name, p.slug AS project_slug,
            p.business_id AS client_id
       FROM widget_configs w
       JOIN projects p ON p.id = w.project_id
      WHERE w.public_id = $1`,
    [publicId],
  )
  if (!rows[0]) return null
  const row = rows[0]
  return {
    widget: mapWidget(row),
    project: { id: row.project_id_ref, name: row.project_name, slug: row.project_slug },
    clientId: row.client_id,
  }
}

const INSERT_FIELDS = [
  'project_id',
  'name',
  'layout',
  'theme',
  'accent',
  'show_stars',
  'show_company',
  'max_items',
  'min_rating',
  'tag_id',
  'status',
  'created_by',
]

/**
 * @param {{ projectId: string, name: string, layout: string, theme: string,
 *   accent: string, showStars: boolean, showCompany: boolean, max: number,
 *   minRating: number | null, tagId: string | null, status?: string,
 *   createdBy?: string | null }} input
 */
export async function createWidget(db, input) {
  const { rows } = await db.query(
    `INSERT INTO widget_configs
       (project_id, name, layout, theme, accent, show_stars, show_company,
        max_items, min_rating, tag_id, status, created_by, public_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      input.projectId,
      input.name,
      input.layout,
      input.theme,
      input.accent,
      input.showStars,
      input.showCompany,
      input.max,
      input.minRating,
      input.tagId,
      input.status ?? 'draft',
      input.createdBy ?? null,
      newPublicId(),
    ],
  )
  return mapWidget(rows[0])
}

const PATCHABLE = {
  name: 'name',
  layout: 'layout',
  theme: 'theme',
  accent: 'accent',
  showStars: 'show_stars',
  showCompany: 'show_company',
  max: 'max_items',
  minRating: 'min_rating',
  tagId: 'tag_id',
  status: 'status',
}

/** Partial update. Only the supplied fields change; returns the fresh row. */
export async function updateWidget(db, id, patch) {
  const columns = []
  const values = []
  for (const [field, column] of Object.entries(PATCHABLE)) {
    if (patch[field] === undefined) continue
    values.push(patch[field])
    columns.push(`${column} = $${values.length}`)
  }
  if (columns.length === 0) {
    const { rows } = await db.query('SELECT * FROM widget_configs WHERE id = $1', [id])
    return rows[0] ? mapWidget(rows[0]) : null
  }
  values.push(id)
  const { rows } = await db.query(
    `UPDATE widget_configs SET ${columns.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  )
  return rows[0] ? mapWidget(rows[0]) : null
}

/**
 * Copies a widget into a new draft. The copy gets a fresh public id, so the
 * original's embeds are unaffected. The name is suffixed and clipped to the
 * 60-character column limit.
 */
export async function duplicateWidget(db, id, createdBy = null) {
  const { rows } = await db.query('SELECT * FROM widget_configs WHERE id = $1', [id])
  const source = rows[0]
  if (!source) throw notFound('Widget not found.')
  const base = `${source.name} (copy)`
  const name = base.length > 60 ? `${base.slice(0, 57)}…` : base
  return createWidget(db, {
    projectId: source.project_id,
    name,
    layout: source.layout,
    theme: source.theme,
    accent: source.accent,
    showStars: source.show_stars,
    showCompany: source.show_company,
    max: source.max_items,
    minRating: source.min_rating,
    tagId: source.tag_id,
    status: 'draft',
    createdBy,
  })
}

export async function deleteWidget(db, id) {
  const { rows } = await db.query('DELETE FROM widget_configs WHERE id = $1 RETURNING id', [id])
  return rows.length
}

/** Aggregates for the dashboard and analytics (scoped like the list). */
export async function widgetCounts(db, workspaceId, allowedClientIds) {
  const params = [workspaceId]
  let scope = ''
  if (allowedClientIds !== null) {
    if (allowedClientIds.length === 0) return { total: 0, live: 0, draft: 0, archived: 0 }
    params.push(allowedClientIds)
    scope = ` AND p.business_id = ANY($${params.length}::uuid[])`
  }
  const { rows } = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE w.status = 'live')::int     AS live,
            count(*) FILTER (WHERE w.status = 'draft')::int    AS draft,
            count(*) FILTER (WHERE w.status = 'archived')::int AS archived
       FROM widget_configs w
       JOIN projects p ON p.id = w.project_id
      WHERE p.workspace_id = $1${scope}`,
    params,
  )
  return rows[0]
}
