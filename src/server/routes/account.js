import { Router } from 'express'
import { accountSchema, changePasswordSchema } from '../../shared/validation.js'
import { hashPassword, verifyPassword } from '../auth.js'
import { badRequest, conflict, notFound, unauthorized } from '../errors.js'
import { asyncHandler, parse, send } from '../http.js'
import { deleteSessionsForUser, findUserById, updateUserPassword } from '../repositories.js'

/**
 * Account controls: profile, email, password, sessions and deletion.
 *
 * Destructive actions require the current password. Deletion is refused while
 * the user shares a workspace, because deleting them would remove clients and
 * testimonials other people rely on.
 */
export function createAccountRouter({ db }) {
  const router = Router()

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      if (!req.user) throw unauthorized()
      send(res, {
        user: { id: req.user.id, name: req.user.name, email: req.user.email, createdAt: req.user.createdAt },
        workspace: req.workspace,
        role: req.role,
      })
    }),
  )

  router.patch(
    '/',
    asyncHandler(async (req, res) => {
      if (!req.user) throw unauthorized()
      const input = parse(accountSchema, req.body)
      const fields = []
      const values = []
      if (input.name !== undefined) {
        values.push(input.name)
        fields.push(`name = $${values.length}`)
      }
      if (input.email !== undefined) {
        values.push(input.email)
        fields.push(`email = $${values.length}`)
      }
      values.push(req.user.id)
      try {
        const { rows } = await db.query(
          `UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length}
           RETURNING id, name, email, created_at`,
          values,
        )
        send(res, {
          user: { id: rows[0].id, name: rows[0].name, email: rows[0].email, createdAt: rows[0].created_at },
        })
      } catch (error) {
        if (error.code === '23505') {
          throw conflict('That email is already in use.', { email: 'That email is already in use.' })
        }
        throw error
      }
    }),
  )

  router.post(
    '/password',
    asyncHandler(async (req, res) => {
      if (!req.user) throw unauthorized()
      const input = parse(changePasswordSchema, req.body)
      const user = await findUserById(db, req.user.id)
      if (!user) throw unauthorized()
      const ok = await verifyPassword(input.currentPassword, user.passwordSalt, user.passwordHash)
      if (!ok) throw badRequest('That password is not correct.', { currentPassword: 'Incorrect password.' })

      const { passwordHash, passwordSalt } = await hashPassword(input.newPassword)
      await updateUserPassword(db, user.id, passwordHash, passwordSalt)
      // Keep the current session, end every other one.
      const ended = await db.query(
        `DELETE FROM sessions WHERE user_id = $1 AND id <> $2`,
        [user.id, req.session.id],
      )
      send(res, { ok: true, otherSessionsEnded: ended.rowCount })
    }),
  )

  router.get(
    '/sessions',
    asyncHandler(async (req, res) => {
      if (!req.user) throw unauthorized()
      const { rows } = await db.query(
        `SELECT id, created_at, last_seen_at, expires_at
           FROM sessions WHERE user_id = $1 ORDER BY created_at DESC`,
        [req.user.id],
      )
      send(res, {
        items: rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          lastSeenAt: row.last_seen_at,
          expiresAt: row.expires_at,
          current: row.id === req.session?.id,
        })),
      })
    }),
  )

  router.delete(
    '/sessions/:id',
    asyncHandler(async (req, res) => {
      if (!req.user) throw unauthorized()
      if (req.params.id === req.session?.id) {
        throw conflict('That is your current session. Use sign out instead.')
      }
      const { rowCount } = await db.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [
        req.params.id,
        req.user.id,
      ])
      if (rowCount === 0) throw notFound('Session not found.')
      res.status(204).end()
    }),
  )

  router.delete(
    '/sessions',
    asyncHandler(async (req, res) => {
      if (!req.user) throw unauthorized()
      const { rowCount } = await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [
        req.user.id,
        req.session.id,
      ])
      send(res, { ended: rowCount })
    }),
  )

  router.delete(
    '/',
    asyncHandler(async (req, res) => {
      if (!req.user) throw unauthorized()
      const password = String(req.body?.password ?? '')
      const user = await findUserById(db, req.user.id)
      const ok = await verifyPassword(password, user.passwordSalt, user.passwordHash)
      if (!ok) throw badRequest('Enter your password to confirm.', { password: 'Incorrect password.' })

      // Refuse if the user shares a workspace — deleting them would cascade
      // clients and testimonials other people depend on.
      const { rows: shared } = await db.query(
        `SELECT w.id, w.name
           FROM workspaces w
           JOIN workspace_members m ON m.workspace_id = w.id
          WHERE w.id IN (SELECT workspace_id FROM workspace_members WHERE user_id = $1)
          GROUP BY w.id, w.name
         HAVING count(m.id) > 1`,
        [req.user.id],
      )
      if (shared.length > 0) {
        throw conflict(
          'You share a workspace with other people. Remove yourself from the team first, or transfer ownership.',
        )
      }

      // Sole-member workspaces cascade to clients, projects and testimonials.
      await db.query(
        `DELETE FROM workspaces WHERE id IN (
           SELECT workspace_id FROM workspace_members WHERE user_id = $1
         )`,
        [req.user.id],
      )
      await deleteSessionsForUser(db, req.user.id)
      await db.query('DELETE FROM users WHERE id = $1', [req.user.id])
      res.status(204).end()
    }),
  )

  return router
}
