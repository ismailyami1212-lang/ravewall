/**
 * Data access layer (PostgreSQL).
 *
 * Every function that touches a scoped row enforces the policy predicates from
 * `policies.js` before returning or mutating anything, so route handlers never
 * have to remember to check ownership. Callers always pass the actor they are
 * acting as; identity is never taken from client supplied input.
 *
 * Two independent defences are applied on purpose:
 *   1. the SQL is always scoped (by `business_id`, or by a join to the owning
 *      business), so a forgotten check cannot return another tenant's rows;
 *   2. the policy layer then decides what the actor may see or change.
 *
 * Column names are snake_case in Postgres and camelCase in the domain objects
 * the routes and the API contract use; the `map*` helpers are the only place
 * that translation happens.
 */
import { PUBLIC_STATUS } from '../shared/constants.js'
import { conflict, forbidden, notFound } from './errors.js'
import { canModifyTestimonial, ownsBusiness, visibleTestimonials } from './policies.js'

/* -------------------------------------------------------------------------- */
/* Row mapping                                                                */
/* -------------------------------------------------------------------------- */

/** Postgres returns `Date` for timestamptz; the API contract uses ISO strings. */
function toIso(value) {
  if (value === null || value === undefined) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

const mapUser = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  passwordHash: row.password_hash,
  passwordSalt: row.password_salt,
  createdAt: toIso(row.created_at),
})

const mapSession = (row) => ({
  id: row.id,
  userId: row.user_id,
  tokenHash: row.token_hash,
  createdAt: toIso(row.created_at),
  lastSeenAt: toIso(row.last_seen_at),
  expiresAt: toIso(row.expires_at),
})

const mapBusiness = (row) => ({
  id: row.id,
  ownerId: row.owner_user_id,
  name: row.name,
  slug: row.slug,
  tagline: row.tagline ?? '',
  logoUrl: row.logo_url ?? '',
  accentColor: row.accent_color,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
})

const mapTestimonial = (row) => ({
  id: row.id,
  businessId: row.business_id,
  rating: Number(row.rating),
  name: row.author_name,
  company: row.company ?? '',
  text: row.content,
  status: row.status,
  source: row.source,
  ipHash: row.ip_hash,
  userAgent: row.user_agent,
  approvedAt: toIso(row.approved_at),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
})

/* -------------------------------------------------------------------------- */
/* Projections — the only shapes that ever leave the server                    */
/* -------------------------------------------------------------------------- */

export function publicUser(user) {
  if (!user) return null
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt }
}

export function publicBusiness(business) {
  if (!business) return null
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    tagline: business.tagline ?? '',
    logoUrl: business.logoUrl ?? '',
    accentColor: business.accentColor,
    createdAt: business.createdAt,
    updatedAt: business.updatedAt,
  }
}

export function publicTestimonial(testimonial) {
  if (!testimonial) return null
  return {
    id: testimonial.id,
    rating: testimonial.rating,
    name: testimonial.name,
    company: testimonial.company ?? '',
    text: testimonial.text,
    status: testimonial.status,
    createdAt: testimonial.createdAt,
    updatedAt: testimonial.updatedAt,
  }
}

/** Wall projection: display fields only, no moderation metadata. */
export function wallTestimonial(testimonial) {
  return {
    id: testimonial.id,
    rating: testimonial.rating,
    name: testimonial.name,
    company: testimonial.company ?? '',
    text: testimonial.text,
    createdAt: testimonial.createdAt,
  }
}

/** Postgres unique-violation code. */
const UNIQUE_VIOLATION = '23505'

function isUniqueViolation(error, constraint) {
  if (!error || error.code !== UNIQUE_VIOLATION) return false
  if (!constraint) return true
  return String(error.constraint ?? '').includes(constraint)
}

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

const normaliseEmail = (email) => String(email).trim().toLowerCase()

export async function findUserByEmail(db, email) {
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [normaliseEmail(email)])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function findUserById(db, id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function createUser(db, { email, passwordHash, passwordSalt, name }) {
  try {
    const { rows } = await db.query(
      `INSERT INTO users (email, name, password_hash, password_salt)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [normaliseEmail(email), name, passwordHash, passwordSalt],
    )
    return mapUser(rows[0])
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_unique')) {
      throw conflict('An account with that email already exists.', {
        email: 'An account with that email already exists.',
      })
    }
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

export async function insertSession(db, session) {
  const { rows } = await db.query(
    `INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $3, $4)
     RETURNING *`,
    [session.userId, session.tokenHash, session.createdAt, session.expiresAt],
  )
  return mapSession(rows[0])
}

export async function findSessionByHash(db, tokenHash) {
  const { rows } = await db.query('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash])
  return rows[0] ? mapSession(rows[0]) : null
}

/**
 * Resolves a session and its user in one round trip — the hot path for every
 * authenticated request.
 */
export async function findSessionWithUser(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT s.*,
            u.id            AS account_id,
            u.email         AS account_email,
            u.name          AS account_name,
            u.password_hash AS account_password_hash,
            u.password_salt AS account_password_salt,
            u.created_at    AS account_created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [tokenHash],
  )
  const row = rows[0]
  if (!row) return null
  return {
    session: mapSession(row),
    user: {
      id: row.account_id,
      email: row.account_email,
      name: row.account_name,
      passwordHash: row.account_password_hash,
      passwordSalt: row.account_password_salt,
      createdAt: toIso(row.account_created_at),
    },
  }
}

export async function deleteSessionByHash(db, tokenHash) {
  const { rowCount } = await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
  return rowCount
}

export async function pruneExpiredSessions(db, now = new Date()) {
  const { rowCount } = await db.query('DELETE FROM sessions WHERE expires_at <= $1', [now])
  return rowCount
}

/** Ends every session for a user — used after a password reset. */
export async function deleteSessionsForUser(db, userId) {
  const { rowCount } = await db.query('DELETE FROM sessions WHERE user_id = $1', [userId])
  return rowCount
}

/* -------------------------------------------------------------------------- */
/* Password resets                                                             */
/* -------------------------------------------------------------------------- */

/** Drops any outstanding reset tokens for a user (older tokens must not linger). */
export async function deletePasswordResetsForUser(db, userId) {
  const { rowCount } = await db.query('DELETE FROM password_resets WHERE user_id = $1', [userId])
  return rowCount
}

/** Records a hashed, expiring, single-use reset token. */
export async function createPasswordReset(db, { userId, tokenHash, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, tokenHash, expiresAt],
  )
  return rows[0] ?? null
}

/**
 * Looks up a reset token by its HMAC. Only unused, unexpired tokens resolve —
 * expiry and single-use are enforced in SQL, not in the caller.
 */
export async function findValidPasswordReset(db, tokenHash, now = new Date()) {
  const { rows } = await db.query(
    `SELECT r.id, r.user_id, r.expires_at, r.used_at
       FROM password_resets r
      WHERE r.token_hash = $1
        AND r.used_at IS NULL
        AND r.expires_at > $2
      LIMIT 1`,
    [tokenHash, now],
  )
  return rows[0] ?? null
}

/** Marks a reset token consumed. Returns false when it was already used. */
export async function consumePasswordReset(db, resetId, now = new Date()) {
  const { rows } = await db.query(
    `UPDATE password_resets
        SET used_at = $2
      WHERE id = $1 AND used_at IS NULL
      RETURNING id`,
    [resetId, now],
  )
  return rows.length > 0
}

/** Replaces a user's password hash and salt. */
export async function updateUserPassword(db, userId, passwordHash, passwordSalt) {
  const { rows } = await db.query(
    `UPDATE users
        SET password_hash = $2, password_salt = $3
      WHERE id = $1
      RETURNING id, email, name, created_at`,
    [userId, passwordHash, passwordSalt],
  )
  return rows[0] ? mapUser(rows[0]) : null
}

/* -------------------------------------------------------------------------- */
/* Businesses                                                                 */
/* -------------------------------------------------------------------------- */

export async function getBusinessByOwner(db, ownerId) {
  const { rows } = await db.query('SELECT * FROM businesses WHERE owner_user_id = $1', [ownerId])
  return rows[0] ? mapBusiness(rows[0]) : null
}

export async function getBusinessById(db, id) {
  const { rows } = await db.query('SELECT * FROM businesses WHERE id = $1', [id])
  return rows[0] ? mapBusiness(rows[0]) : null
}

export async function getBusinessBySlug(db, slug) {
  const { rows } = await db.query('SELECT * FROM businesses WHERE slug = $1', [
    String(slug).trim().toLowerCase(),
  ])
  return rows[0] ? mapBusiness(rows[0]) : null
}

/**
 * Walls that are safe to list in the sitemap: the business's default project
 * has at least one approved testimonial. A wall with no approved stories is
 * thin content and is deliberately omitted.
 *
 * `lastmod` follows the newest approved row, so a re-crawl sees fresh content
 * without exposing pending or rejected testimonials.
 */
export async function listIndexableWalls(db) {
  const { rows } = await db.query(
    `SELECT b.slug,
            max(t.updated_at) AS lastmod
       FROM businesses b
       JOIN LATERAL (
         SELECT id
           FROM projects
          WHERE business_id = b.id
          ORDER BY is_default DESC, created_at ASC
          LIMIT 1
       ) p ON true
       JOIN testimonials t
         ON t.project_id = p.id
        AND t.status = $1
      GROUP BY b.id, b.slug, b.created_at
      ORDER BY b.created_at ASC`,
    [PUBLIC_STATUS],
  )
  return rows.map((row) => ({ slug: row.slug, lastmod: toIso(row.lastmod) }))
}

export async function isSlugTaken(db, slug, exceptId = null) {
  const normalised = String(slug).trim().toLowerCase()
  const { rows } = exceptId
    ? await db.query('SELECT 1 FROM businesses WHERE slug = $1 AND id <> $2', [normalised, exceptId])
    : await db.query('SELECT 1 FROM businesses WHERE slug = $1', [normalised])
  return rows.length > 0
}

/**
 * Legacy helper retained for the data-layer tests. Every business now lives in a
 * workspace, so this creates the workspace (and owner membership) when the caller
 * does not supply one. New code should use `createClient` from workspaces.js,
 * which also creates the default project.
 */
export async function createBusiness(db, ownerId, data) {
  const workspaceId = data.workspaceId ?? (await createWorkspaceForOwner(db, ownerId)).id
  try {
    const { rows } = await db.query(
      `INSERT INTO businesses (workspace_id, owner_user_id, name, slug, tagline, logo_url, accent_color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        workspaceId,
        ownerId,
        data.name,
        data.slug,
        data.tagline ?? '',
        data.logUrl ?? '',
        data.accentColor,
      ],
    )
    return mapBusiness(rows[0])
  } catch (error) {
    if (isUniqueViolation(error, 'businesses_owner_unique')) {
      throw conflict('This account already has a business profile.')
    }
    if (isUniqueViolation(error, 'businesses_slug_unique')) {
      throw conflict('That link name is already taken.', { slug: 'That link name is taken.' })
    }
    throw error
  }
}

/** Creates a workspace + owner membership for a user (used by tests and fixtures). */
async function createWorkspaceForOwner(db, ownerId) {
  const { rows } = await db.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING *', [
    `workspace-${ownerId.slice(0, 8)}`,
  ])
  const workspace = rows[0]
  await db.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, status)
     VALUES ($1, $2, 'owner', 'active')`,
    [workspace.id, ownerId],
  )
  return { id: workspace.id }
}

/** Columns a client is allowed to change, mapped to their column names. */
const BUSINESS_PATCHABLE = {
  name: 'name',
  slug: 'slug',
  tagline: 'tagline',
  logoUrl: 'logo_url',
  accentColor: 'accent_color',
}

/**
 * Updates a business. Throws unless the actor owns the row.
 * @param {any} db
 * @param {import('./policies.js').Actor} actor
 * @param {string} businessId
 * @param {Record<string, unknown>} patch
 */
export async function updateBusiness(db, actor, businessId, patch) {
  const business = await getBusinessById(db, businessId)
  if (!business) throw notFound('Business not found.')
  if (!ownsBusiness(actor, business)) throw forbidden()

  const columns = []
  const values = []
  for (const [field, column] of Object.entries(BUSINESS_PATCHABLE)) {
    if (patch[field] === undefined) continue
    values.push(patch[field])
    columns.push(`${column} = $${values.length}`)
  }
  if (columns.length === 0) return business

  values.push(businessId)
  try {
    const { rows } = await db.query(
      `UPDATE businesses SET ${columns.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    )
    return rows[0] ? mapBusiness(rows[0]) : business
  } catch (error) {
    if (isUniqueViolation(error, 'businesses_slug_unique')) {
      throw conflict('That link name is already taken.', { slug: 'That link name is taken.' })
    }
    throw error
  }
}

/* -------------------------------------------------------------------------- */
/* Testimonials                                                               */
/* -------------------------------------------------------------------------- */

/**
 * @param {any} db
 * @param {{ id: string }} business
 * @param {{ rating: number, name: string, company?: string, text: string }} input
 * @param {{ ipHash?: string | null, userAgent?: string | null, projectId?: string, answers?: Record<string,string> }} [meta]
 */
export async function createTestimonial(db, business, input, meta = {}) {
  const { rows } = await db.query(
    `INSERT INTO testimonials (business_id, project_id, author_name, company, rating, content, status, source, ip_hash, user_agent, answers)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'link', $7, $8, $9)
     RETURNING *`,
    [
      business.id,
      meta.projectId ?? null,
      input.name,
      input.company ?? '',
      input.rating,
      input.text,
      meta.ipHash ?? null,
      meta.userAgent ? String(meta.userAgent).slice(0, 200) : null,
      JSON.stringify(meta.answers ?? {}),
    ],
  )
  return mapTestimonial(rows[0])
}

export async function getTestimonial(db, id) {
  const { rows } = await db.query('SELECT * FROM testimonials WHERE id = $1', [id])
  return rows[0] ? mapTestimonial(rows[0]) : null
}

/**
 * Whitelisted ORDER BY clauses. Sort keys never reach SQL as raw input.
 */
const TESTIMONIAL_ORDER = {
  newest: 'created_at DESC, id DESC',
  oldest: 'created_at ASC, id ASC',
  rating: 'rating DESC, created_at DESC, id DESC',
}

/** Upper bound on a single moderation page, so the response cannot be unbounded. */
const MODERATION_PAGE_LIMIT = 1000

/**
 * Lists the moderation queue for a business. The business must belong to the
 * actor; callers cannot request another tenant's queue because the business is
 * resolved from the actor, never from the request body.
 */
export async function listTestimonials(db, actor, business, query = {}, projectId = null, { trusted = false } = {}) {
  const params = [business.id]
  const conditions = ['business_id = $1']

  const status = query.status ?? 'all'
  if (status !== 'all') {
    params.push(status)
    conditions.push(`status = $${params.length}`)
  }

  if (projectId) {
    params.push(projectId)
    conditions.push(`project_id = $${params.length}`)
  }

  const term = String(query.q ?? '').trim().toLowerCase()
  if (term) {
    // `strpos` avoids LIKE metacharacter escaping entirely.
    params.push(term)
    conditions.push(
      `strpos(lower(concat_ws(' ', author_name, company, content)), $${params.length}) > 0`,
    )
  }

  const order = TESTIMONIAL_ORDER[query.sort] ?? TESTIMONIAL_ORDER.newest
  params.push(MODERATION_PAGE_LIMIT)

  const { rows } = await db.query(
    `SELECT * FROM testimonials
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${order}
      LIMIT $${params.length}`,
    params,
  )

  const mapped = rows.map(mapTestimonial)
  // When the route has already authorised this client through the workspace
  // membership + client scope (`requireClientAccess`), the SQL above is the
  // authority and every row belongs to the caller. Otherwise the legacy
  // owner-only policy still filters the result.
  if (trusted) return mapped
  return visibleTestimonials(actor, mapped, business)
}

/**
 * Loads a testimonial together with the owner of its business, so the caller can
 * be authorised without a second round trip.
 */
async function loadTestimonialWithOwner(client, testimonialId) {
  const { rows } = await client.query(
    `SELECT t.*, b.owner_user_id
       FROM testimonials t
       JOIN businesses b ON b.id = t.business_id
      WHERE t.id = $1`,
    [testimonialId],
  )
  if (rows.length === 0) return null
  return {
    testimonial: mapTestimonial(rows[0]),
    business: { id: rows[0].business_id, ownerId: rows[0].owner_user_id },
  }
}

/**
 * Changes a testimonial's moderation status.
 * @param {any} db
 * @param {import('./policies.js').Actor} actor
 * @param {string} testimonialId
 * @param {'pending' | 'approved' | 'rejected'} status
 */
export async function setTestimonialStatus(db, actor, testimonialId, status) {
  return db.transaction(async (client) => {
    const found = await loadTestimonialWithOwner(client, testimonialId)
    if (!found) throw notFound('Testimonial not found.')
    if (!canModifyTestimonial(actor, found.testimonial, found.business)) {
      // A row the actor cannot touch is reported as missing, so the API does not
      // leak the existence of other tenants' data.
      throw notFound('Testimonial not found.')
    }

    const { rows } = await client.query(
      `UPDATE testimonials
          SET status = $2,
              approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE NULL END
        WHERE id = $1 AND business_id = $3
        RETURNING *`,
      [testimonialId, status, found.testimonial.businessId],
    )
    if (rows.length === 0) throw notFound('Testimonial not found.')
    return mapTestimonial(rows[0])
  })
}

/**
 * @param {any} db
 * @param {import('./policies.js').Actor} actor
 * @param {string} testimonialId
 */
export async function deleteTestimonial(db, actor, testimonialId) {
  return db.transaction(async (client) => {
    const found = await loadTestimonialWithOwner(client, testimonialId)
    if (!found) throw notFound('Testimonial not found.')
    if (!canModifyTestimonial(actor, found.testimonial, found.business)) {
      throw notFound('Testimonial not found.')
    }

    const { rows } = await client.query(
      'DELETE FROM testimonials WHERE id = $1 AND business_id = $2 RETURNING *',
      [testimonialId, found.testimonial.businessId],
    )
    if (rows.length === 0) throw notFound('Testimonial not found.')
    return mapTestimonial(rows[0])
  })
}

/**
 * Approved testimonials for the public wall, newest first.
 *
 * The `status = 'approved'` predicate is applied by Postgres, not by the caller,
 * so a pending or rejected row can never be part of the result set — this is the
 * SQL form of `canReadTestimonial` for an anonymous visitor.
 */
export async function listWall(db, business, limit = 120) {
  const { rows } = await db.query(
    `SELECT * FROM testimonials
      WHERE business_id = $1 AND status = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [business.id, PUBLIC_STATUS, limit],
  )
  return rows.map(mapTestimonial)
}

/** Counts submissions for a business created at or after `since`. */
export async function countSubmissionsSince(db, businessId, since) {
  const { rows } = await db.query(
    'SELECT count(*)::integer AS count FROM testimonials WHERE business_id = $1 AND created_at >= $2',
    [businessId, since],
  )
  return Number(rows[0]?.count ?? 0)
}

export async function businessStats(db, businessId, projectId = null) {
  const params = [businessId]
  let scope = ''
  if (projectId) {
    params.push(projectId)
    scope = ` AND project_id = $${params.length}`
  }
  const { rows } = await db.query(
    `SELECT count(*)::integer                                              AS total,
            count(*) FILTER (WHERE status = 'pending')::integer            AS pending,
            count(*) FILTER (WHERE status = 'approved')::integer           AS approved,
            count(*) FILTER (WHERE status = 'rejected')::integer           AS rejected,
            coalesce(avg(rating) FILTER (WHERE status = 'approved'), 0)    AS average_rating,
            max(created_at)                                                AS last_submission_at
       FROM testimonials
      WHERE business_id = $1${scope}`,
    params,
  )
  const row = rows[0] ?? {}
  return {
    total: Number(row.total ?? 0),
    pending: Number(row.pending ?? 0),
    approved: Number(row.approved ?? 0),
    rejected: Number(row.rejected ?? 0),
    averageRating: Math.round(Number(row.average_rating ?? 0) * 10) / 10,
    lastSubmissionAt: toIso(row.last_submission_at),
  }
}

/* -------------------------------------------------------------------------- */
/* Project-scoped reads (workspace model)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Approved testimonials for a project, optionally narrowed by rating or tag.
 * The `status = 'approved'` predicate is applied by Postgres, never the caller.
 */
export async function listWallByProject(db, projectId, { limit = 120, minRating = null, tagId = null } = {}) {
  const params = [projectId, PUBLIC_STATUS]
  let sql = `SELECT t.* FROM testimonials t
              WHERE t.project_id = $1 AND t.status = $2`
  if (minRating) {
    params.push(minRating)
    sql += ` AND t.rating >= $${params.length}`
  }
  if (tagId) {
    params.push(tagId)
    sql += ` AND EXISTS (SELECT 1 FROM testimonial_tags tt WHERE tt.testimonial_id = t.id AND tt.tag_id = $${params.length})`
  }
  params.push(limit)
  sql += ` ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length}`
  const { rows } = await db.query(sql, params)
  return rows.map(mapTestimonial)
}

/** A testimonial with its project, for route-level authorisation. */
export async function getTestimonialWithProject(db, testimonialId) {
  const { rows } = await db.query(
    `SELECT t.*, p.workspace_id, p.business_id AS project_business_id
       FROM testimonials t
       JOIN projects p ON p.id = t.project_id
      WHERE t.id = $1`,
    [testimonialId],
  )
  if (!rows[0]) return null
  return { testimonial: mapTestimonial(rows[0]), projectId: rows[0].project_id, workspaceId: rows[0].workspace_id }
}

/** Status change by id — authorisation happens in the route. */
export async function setTestimonialStatusById(db, testimonialId, status) {
  const { rows } = await db.query(
    `UPDATE testimonials
        SET status = $2, approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE NULL END
      WHERE id = $1 RETURNING *`,
    [testimonialId, status],
  )
  return rows[0] ? mapTestimonial(rows[0]) : null
}

/** Delete by id — authorisation happens in the route. */
export async function deleteTestimonialById(db, testimonialId) {
  const { rows } = await db.query('DELETE FROM testimonials WHERE id = $1 RETURNING *', [testimonialId])
  return rows[0] ? mapTestimonial(rows[0]) : null
}

/** Custom questions for a project, in display order. */
export async function listProjectQuestions(db, projectId) {
  const { rows } = await db.query(
    'SELECT * FROM custom_questions WHERE project_id = $1 ORDER BY position, created_at',
    [projectId],
  )
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    type: row.type,
    required: row.required,
  }))
}
