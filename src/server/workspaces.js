/**
 * Workspace, client, project and team data access.
 *
 * Same contract as `repositories.js`: every function that touches scoped data
 * takes the caller's membership (or an explicit allowed-client list) and
 * enforces the rules before returning anything. SQL is always scoped by
 * workspace as well, so a forgotten check cannot leak another tenant's rows.
 */
import { conflict, notFound } from './errors.js'
import { canManageClients, canManageTeam, canModerate, clientInScope, isUnscoped } from './access.js'

const UNIQUE_VIOLATION = '23505'

function isUnique(error, constraint) {
  return error?.code === UNIQUE_VIOLATION && (!constraint || String(error.constraint ?? '').includes(constraint))
}

const toIso = (value) => (value instanceof Date ? value.toISOString() : value ?? null)

const mapWorkspace = (row) => ({
  id: row.id,
  name: row.name,
  plan: row.plan,
  createdAt: toIso(row.created_at),
})

const mapMember = (row) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  userId: row.user_id,
  role: row.role,
  status: row.status,
  name: row.name ?? null,
  email: row.email ?? null,
  createdAt: toIso(row.created_at),
})

const mapClient = (row) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  ownerId: row.owner_user_id,
  name: row.name,
  slug: row.slug,
  tagline: row.tagline ?? '',
  logoUrl: row.logo_url ?? '',
  accentColor: row.accent_color,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
})

const mapProject = (row) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  clientId: row.business_id,
  name: row.name,
  slug: row.slug,
  isDefault: row.is_default === true,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
})

/* -------------------------------------------------------------------------- */
/* Memberships                                                                */
/* -------------------------------------------------------------------------- */

/** Every workspace the user belongs to, newest membership first. */
export async function listMemberships(db, userId) {
  const { rows } = await db.query(
    `SELECT m.id, m.workspace_id, m.user_id, m.role, m.status, m.created_at,
            w.name AS workspace_name, w.plan
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND m.status = 'active'
      ORDER BY m.created_at ASC`,
    [userId],
  )
  return rows.map((row) => ({
    ...mapMember(row),
    workspaceName: row.workspace_name,
    plan: row.plan,
  }))
}

export async function getMembership(db, workspaceId, userId) {
  const { rows } = await db.query(
    `SELECT m.*, w.name AS workspace_name, w.plan
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [workspaceId, userId],
  )
  return rows[0] ? { ...mapMember(rows[0]), workspaceName: rows[0].workspace_name } : null
}

/** Client ids a member may touch; null means "all clients in the workspace". */
export async function listMemberClientIds(db, member) {
  if (isUnscoped(member.role)) return null
  const { rows } = await db.query(
    'SELECT business_id FROM workspace_member_clients WHERE member_id = $1',
    [member.id],
  )
  return rows.map((row) => row.business_id)
}

export async function listTeam(db, workspaceId) {
  const { rows } = await db.query(
    `SELECT m.*, u.name, u.email
       FROM workspace_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END,
               m.created_at ASC`,
    [workspaceId],
  )
  const members = rows.map(mapMember)
  if (members.length === 0) return members

  const { rows: assignments } = await db.query(
    `SELECT c.member_id, c.business_id
       FROM workspace_member_clients c
       JOIN workspace_members m ON m.id = c.member_id
      WHERE m.workspace_id = $1`,
    [workspaceId],
  )
  const byMember = new Map()
  for (const row of assignments) {
    const list = byMember.get(row.member_id) ?? []
    list.push(row.business_id)
    byMember.set(row.member_id, list)
  }
  return members.map((member) => ({ ...member, clientIds: byMember.get(member.id) ?? [] }))
}

export async function addMember(db, workspaceId, userId, role = 'manager') {
  try {
    const { rows } = await db.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING *`,
      [workspaceId, userId, role],
    )
    return mapMember(rows[0])
  } catch (error) {
    if (isUnique(error, 'workspace_members_unique')) {
      throw conflict('That person is already in this workspace.')
    }
    throw error
  }
}

export async function updateMemberRole(db, workspaceId, userId, role) {
  const { rows } = await db.query(
    `UPDATE workspace_members SET role = $3
      WHERE workspace_id = $1 AND user_id = $2
      RETURNING *`,
    [workspaceId, userId, role],
  )
  return rows[0] ? mapMember(rows[0]) : null
}

export async function removeMember(db, workspaceId, userId) {
  const { rowCount } = await db.query(
    'DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  )
  return rowCount
}

export async function setMemberClients(db, workspaceId, userId, clientIds) {
  return db.transaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId],
    )
    if (rows.length === 0) throw notFound('Member not found.')
    const memberId = rows[0].id
    await client.query('DELETE FROM workspace_member_clients WHERE member_id = $1', [memberId])
    for (const clientId of clientIds) {
      await client.query(
        `INSERT INTO workspace_member_clients (member_id, business_id)
         SELECT $1, id FROM businesses WHERE id = $2 AND workspace_id = $3
         ON CONFLICT DO NOTHING`,
        [memberId, clientId, workspaceId],
      )
    }
    return memberId
  })
}

export async function countOwners(db, workspaceId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM workspace_members
      WHERE workspace_id = $1 AND role = 'owner' AND status = 'active'`,
    [workspaceId],
  )
  return rows[0].n
}

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                 */
/* -------------------------------------------------------------------------- */

export async function createWorkspace(db, { name, ownerUserId }) {
  return db.transaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO workspaces (name) VALUES ($1) RETURNING *',
      [name],
    )
    const workspace = mapWorkspace(rows[0])
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [workspace.id, ownerUserId],
    )
    return workspace
  })
}

export async function renameWorkspace(db, workspaceId, name) {
  const { rows } = await db.query(
    'UPDATE workspaces SET name = $2 WHERE id = $1 RETURNING *',
    [workspaceId, name],
  )
  return rows[0] ? mapWorkspace(rows[0]) : null
}

export async function deleteWorkspace(db, workspaceId) {
  const { rowCount } = await db.query('DELETE FROM workspaces WHERE id = $1', [workspaceId])
  return rowCount
}

/* -------------------------------------------------------------------------- */
/* Clients (businesses)                                                       */
/* -------------------------------------------------------------------------- */

export async function listClients(db, workspaceId, allowedIds) {
  const params = [workspaceId]
  let scope = ''
  if (allowedIds !== null) {
    if (allowedIds.length === 0) return []
    params.push(allowedIds)
    scope = ` AND id = ANY($${params.length}::uuid[])`
  }
  const { rows } = await db.query(
    `SELECT * FROM businesses WHERE workspace_id = $1${scope} ORDER BY created_at ASC`,
    params,
  )
  return rows.map(mapClient)
}

export async function getClientById(db, id) {
  const { rows } = await db.query('SELECT * FROM businesses WHERE id = $1', [id])
  return rows[0] ? mapClient(rows[0]) : null
}

export async function createClient(db, { workspaceId, ownerUserId, name, slug, tagline, logoUrl, accentColor }) {
  return db.transaction(async (client) => {
    let business
    try {
      const { rows } = await client.query(
        `INSERT INTO businesses (workspace_id, owner_user_id, name, slug, tagline, logo_url, accent_color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [workspaceId, ownerUserId, name, slug, tagline ?? '', logoUrl ?? '', accentColor],
      )
      business = mapClient(rows[0])
    } catch (error) {
      if (isUnique(error, 'businesses_slug_unique')) {
        throw conflict('That link name is already taken.', { slug: 'That link name is taken.' })
      }
      throw error
    }

    // Every client starts with a default project that keeps the client's slug,
    // so /t/:slug and /wall/:slug work the moment the client exists.
    await client.query(
      `INSERT INTO projects (workspace_id, business_id, name, slug, is_default)
       VALUES ($1, $2, $3, $4, true)`,
      [workspaceId, business.id, business.name, business.slug],
    )
    return business
  })
}

export async function updateClient(db, id, patch) {
  const columns = []
  const values = []
  const map = { name: 'name', slug: 'slug', tagline: 'tagline', logoUrl: 'logo_url', accentColor: 'accent_color' }
  for (const [field, column] of Object.entries(map)) {
    if (patch[field] === undefined) continue
    values.push(patch[field])
    columns.push(`${column} = $${values.length}`)
  }
  if (columns.length === 0) return getClientById(db, id)
  values.push(id)
  try {
    const { rows } = await db.query(
      `UPDATE businesses SET ${columns.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    )
    return rows[0] ? mapClient(rows[0]) : null
  } catch (error) {
    if (isUnique(error, 'businesses_slug_unique')) {
      throw conflict('That link name is already taken.', { slug: 'That link name is taken.' })
    }
    throw error
  }
}

export async function deleteClient(db, id) {
  const { rowCount } = await db.query('DELETE FROM businesses WHERE id = $1', [id])
  return rowCount
}

export async function countClients(db, workspaceId) {
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM businesses WHERE workspace_id = $1',
    [workspaceId],
  )
  return rows[0].n
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

export async function listProjects(db, workspaceId, allowedIds) {
  const params = [workspaceId]
  let scope = ''
  if (allowedIds !== null) {
    if (allowedIds.length === 0) return []
    params.push(allowedIds)
    scope = ` AND p.business_id = ANY($${params.length}::uuid[])`
  }
  const { rows } = await db.query(
    `SELECT p.*, b.name AS client_name, b.accent_color
       FROM projects p
       JOIN businesses b ON b.id = p.business_id
      WHERE p.workspace_id = $1${scope}
      ORDER BY b.created_at ASC, p.is_default DESC, p.created_at ASC`,
    params,
  )
  return rows.map((row) => ({
    ...mapProject(row),
    clientName: row.client_name,
    accentColor: row.accent_color,
  }))
}

export async function getProjectById(db, id) {
  const { rows } = await db.query('SELECT * FROM projects WHERE id = $1', [id])
  return rows[0] ? mapProject(rows[0]) : null
}

export async function getProjectBySlug(db, slug) {
  const { rows } = await db.query(
    `SELECT p.*, b.name AS client_name
       FROM projects p
       JOIN businesses b ON b.id = p.business_id
      WHERE p.slug = $1`,
    [String(slug).trim().toLowerCase()],
  )
  if (!rows[0]) return null
  return { ...mapProject(rows[0]), clientName: rows[0].client_name }
}

export async function getDefaultProject(db, clientId) {
  const { rows } = await db.query(
    'SELECT * FROM projects WHERE business_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1',
    [clientId],
  )
  return rows[0] ? mapProject(rows[0]) : null
}

export async function createProject(db, { workspaceId, clientId, name, slug }) {
  try {
    const { rows } = await db.query(
      `INSERT INTO projects (workspace_id, business_id, name, slug, is_default)
       VALUES ($1, $2, $3, $4, false)
       RETURNING *`,
      [workspaceId, clientId, name, slug],
    )
    return mapProject(rows[0])
  } catch (error) {
    if (isUnique(error, 'projects_slug_unique')) {
      throw conflict('That project link is already taken.', { slug: 'That project link is taken.' })
    }
    throw error
  }
}

export async function updateProject(db, id, patch) {
  const columns = []
  const values = []
  if (patch.name !== undefined) {
    values.push(patch.name)
    columns.push(`name = $${values.length}`)
  }
  if (patch.slug !== undefined) {
    values.push(patch.slug)
    columns.push(`slug = $${values.length}`)
  }
  if (columns.length === 0) return getProjectById(db, id)
  values.push(id)
  try {
    const { rows } = await db.query(
      `UPDATE projects SET ${columns.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    )
    return rows[0] ? mapProject(rows[0]) : null
  } catch (error) {
    if (isUnique(error, 'projects_slug_unique')) {
      throw conflict('That project link is already taken.', { slug: 'That project link is taken.' })
    }
    throw error
  }
}

export async function deleteProject(db, id) {
  const project = await getProjectById(db, id)
  if (!project) return 0
  if (project.isDefault) {
    throw conflict('The default project cannot be deleted. Rename it instead.')
  }
  const { rowCount } = await db.query('DELETE FROM projects WHERE id = $1', [id])
  return rowCount
}

/* -------------------------------------------------------------------------- */
/* Access helpers used by routes                                              */
/* -------------------------------------------------------------------------- */

/** Loads a client only if it belongs to the workspace and the member's scope. */
export async function requireClientAccess(db, member, workspaceId, clientId, { write = false } = {}) {
  const allowed = await listMemberClientIds(db, member)
  if (allowed !== null && !allowed.includes(clientId)) throw notFound('Client not found.')
  if (write && !canModerate(member.role)) throw notFound('Client not found.')
  const { rows } = await db.query(
    'SELECT * FROM businesses WHERE id = $1 AND workspace_id = $2',
    [clientId, workspaceId],
  )
  if (!rows[0]) throw notFound('Client not found.')
  return mapClient(rows[0])
}

/** Loads a project only if its client is in scope. */
export async function requireProjectAccess(db, member, workspaceId, projectId, { write = false } = {}) {
  const project = await getProjectById(db, projectId)
  if (!project || project.workspaceId !== workspaceId) throw notFound('Project not found.')
  await requireClientAccess(db, member, workspaceId, project.clientId, { write })
  return project
}

export { clientInScope, canManageClients, canManageTeam, canModerate, isUnscoped }
