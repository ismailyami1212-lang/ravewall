/**
 * Workspace access rules.
 *
 * One place decides what a role may do, so routes never invent their own
 * checks. Client scoping is a second, independent filter: a manager only ever
 * sees the clients explicitly assigned to them, and every query that reads or
 * writes client data is bounded by that list.
 *
 * Roles:
 *   owner   — everything, including workspace deletion and team management
 *   admin   — everything except deleting the workspace
 *   manager — only assigned clients: projects, moderation, widgets
 *   viewer  — read-only, only assigned clients
 */

export const ROLES = ['owner', 'admin', 'manager', 'viewer']

/** Roles that are not limited to assigned clients. */
export function isUnscoped(role) {
  return role === 'owner' || role === 'admin'
}

export function canManageTeam(role) {
  return role === 'owner' || role === 'admin'
}

export function canManageClients(role) {
  return role === 'owner' || role === 'admin'
}

/** Billing is owner/admin only. Managers and viewers cannot spend money. */
export function canManageBilling(role) {
  return role === 'owner' || role === 'admin'
}

export function canModerate(role) {
  return role === 'owner' || role === 'admin' || role === 'manager'
}

export function canDeleteWorkspace(role) {
  return role === 'owner'
}

export function canRead(role) {
  return ROLES.includes(role)
}

/**
 * Normalises a requested workspace id against the caller's memberships.
 * Returns the membership to act as, or null when the caller has no access —
 * which callers must treat as 404, never 403.
 *
 * @param {Array<{ workspaceId: string, role: string }>} memberships
 * @param {string | undefined} requested
 */
export function resolveMembership(memberships, requested) {
  if (memberships.length === 0) return null
  if (!requested) return memberships[0]
  return memberships.find((membership) => membership.workspaceId === requested) ?? null
}

/**
 * Filters a list of clients by the member's scope.
 * @param {string | null} allowedIds null means "everything in the workspace"
 */
export function clientInScope(allowedIds, clientId) {
  if (allowedIds === null) return true
  return allowedIds.includes(clientId)
}
