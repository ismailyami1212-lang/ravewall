/**
 * Password hashing, session handling and the auth gate middleware.
 *
 * - Passwords are hashed with scrypt and a per-user random salt; comparisons are
 *   constant time. The stored hash is never reversible and never leaves the DB
 *   layer except as the two columns `verifyPassword` needs.
 * - Session tokens are random 32-byte values. Only an HMAC of the token is
 *   stored, so a database dump cannot be replayed as a session.
 * - The token travels in an httpOnly, SameSite=Lax, Secure-in-production cookie
 *   and is never exposed to JavaScript.
 * - Every login mints a brand new session row and a new cookie value, so a
 *   pre-existing cookie can never be promoted to an authenticated session.
 */
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { SESSION_COOKIE } from '../shared/constants.js'
import { resolveMembership } from './access.js'
import { AppError, databaseUnavailable, unauthorized } from './errors.js'
import { ANONYMOUS, userActor } from './policies.js'
import {
  deleteSessionByHash,
  findSessionWithUser,
  insertSession,
  pruneExpiredSessions,
} from './repositories.js'
import { listClients, listMemberClientIds, listMemberships } from './workspaces.js'

const scrypt = promisify(crypto.scrypt)
const KEY_LENGTH = 64

/**
 * @param {string} password
 * @returns {Promise<{ passwordHash: string, passwordSalt: string }>}
 */
export async function hashPassword(password) {
  const passwordSalt = crypto.randomBytes(16).toString('hex')
  const derived = await scrypt(password, passwordSalt, KEY_LENGTH)
  return { passwordHash: derived.toString('hex'), passwordSalt }
}

/**
 * @param {string} password
 * @param {string} passwordSalt
 * @param {string} passwordHash
 */
export async function verifyPassword(password, passwordSalt, passwordHash) {
  try {
    const derived = await scrypt(password, passwordSalt, KEY_LENGTH)
    const expected = Buffer.from(passwordHash, 'hex')
    if (expected.length !== derived.length) return false
    return crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/** Stable, non-reversible fingerprint used for rate limiting and audit. */
export function fingerprint(value, secret) {
  if (!value) return null
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex').slice(0, 32)
}

export function hashSessionToken(token, secret) {
  return crypto.createHmac('sha256', secret).update(token).digest('hex')
}

/* -------------------------------------------------------------------------- */
/* Password reset tokens                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A URL-safe, cryptographically random reset token. The raw value exists only
 * in the email; the database stores `hashResetToken(token, secret)`.
 * @param {import('./config.js').Config} _config
 */
export function generateResetToken(_config) {
  return crypto.randomBytes(32).toString('base64url')
}

/** HMAC of a reset token — the only form ever persisted. */
export function hashResetToken(token, secret) {
  return crypto.createHmac('sha256', secret).update(token).digest('hex')
}

/**
 * Creates and persists a session for a user.
 * @param {any} db
 * @param {string} userId
 * @param {any} config
 * @returns {Promise<{ token: string, expiresAt: string }>}
 */
export async function issueSession(db, userId, config) {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  const expiresAt = new Date(now + config.sessionTtlDays * 24 * 60 * 60 * 1000)
  await insertSession(db, {
    userId,
    tokenHash: hashSessionToken(token, config.sessionSecret),
    createdAt: new Date(now),
    expiresAt,
  })
  return { token, expiresAt: expiresAt.toISOString() }
}

/**
 * Resolves a raw cookie token into `{ session, user }` or null.
 * Expiry is enforced here as well as in the query, so a clock skew between the
 * app and Postgres cannot resurrect a dead session.
 * @param {any} db
 * @param {string | undefined} token
 * @param {any} config
 */
export async function resolveSession(db, token, config) {
  if (!token) return null
  const found = await findSessionWithUser(db, hashSessionToken(token, config.sessionSecret))
  if (!found) return null
  if (new Date(found.session.expiresAt).getTime() <= Date.now()) return null
  return found
}

export async function revokeSession(db, token, config) {
  if (!token) return 0
  return deleteSessionByHash(db, hashSessionToken(token, config.sessionSecret))
}

export async function sweepSessions(db) {
  return pruneExpiredSessions(db)
}

export function sessionCookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: /** @type {const} */ ('lax'),
    secure: config.isProduction,
    path: '/',
    maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
  }
}

export function setSessionCookie(res, token, config) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config))
}

export function clearSessionCookie(res, config) {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(config), maxAge: undefined })
}

/**
 * Populates `req.actor`, `req.user`, `req.session`, `req.business`,
 * `req.memberships`, `req.membership`, `req.workspace`, `req.role` and
 * `req.clientScope`.
 *
 * The active workspace comes from the `x-workspace-id` header (or `?workspace=`)
 * and must match one of the caller's memberships — an unknown id resolves to
 * no workspace, never to someone else's.
 *
 * `req.business` is kept for the legacy single-client endpoints: it is the
 * first client in the active workspace that the member may see. New endpoints
 * address clients and projects by id and check scope explicitly.
 *
 * Mounted on the API router only: static assets and the SPA shell must never
 * cost a database round trip. A database failure here is surfaced as a 503
 * rather than being swallowed into an anonymous request, which would otherwise
 * disguise an outage as a wave of 401s.
 */
export function attachActor(db, config) {
  return async (req, _res, next) => {
    try {
      const resolved = await resolveSession(db, req.cookies?.[SESSION_COOKIE], config)
      if (!resolved) {
        req.user = null
        req.session = null
        req.actor = ANONYMOUS
        req.business = null
        req.memberships = []
        req.membership = null
        req.workspace = null
        req.role = null
        req.clientScope = []
        next()
        return
      }

      req.user = resolved.user
      req.session = resolved.session
      req.actor = userActor(resolved.user)

      const memberships = await listMemberships(db, resolved.user.id)
      const requested = req.get('x-workspace-id') ?? req.query.workspace
      const membership = resolveMembership(memberships, requested)

      req.memberships = memberships
      req.membership = membership
      req.workspace = membership
        ? { id: membership.workspaceId, name: membership.workspaceName, plan: membership.plan }
        : null
      req.role = membership?.role ?? null
      req.clientScope = membership ? await listMemberClientIds(db, membership) : []

      if (membership) {
        const clients = await listClients(db, membership.workspaceId, req.clientScope)
        req.business = clients[0] ?? null
      } else {
        // Workspace membership is the sole authority for tenant data. A user
        // with no active membership (for example, someone removed from a
        // workspace) must not fall back to legacy owner-user ownership.
        req.business = null
      }

      next()
    } catch (error) {
      next(databaseUnavailable(error))
    }
  }
}

/** Auth gate for every owner-scoped endpoint. */
export function requireUser(req, _res, next) {
  if (!req.user) return next(unauthorized())
  next()
}

/**
 * Auth gate for endpoints that operate on the caller's own business.
 * A missing business is a client error the UI turns into "finish your business
 * setup", not a 404 — the account is valid, the workspace simply is not ready.
 */
export function requireBusiness(req, _res, next) {
  if (!req.user) return next(unauthorized())
  if (!req.business) {
    return next(
      new AppError(409, 'business_setup_required', 'Create your business profile to continue.'),
    )
  }
  next()
}
