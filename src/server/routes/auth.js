import { Router } from 'express'
import { SESSION_COOKIE } from '../../shared/constants.js'
import { loginSchema, signupSchema, emailSchema, passwordSchema } from '../../shared/validation.js'
import {
  clearSessionCookie,
  generateResetToken,
  hashPassword,
  hashResetToken,
  issueSession,
  revokeSession,
  setSessionCookie,
  verifyPassword,
} from '../auth.js'
import { renderResetEmail, sendEmail } from '../email.js'
import { badRequest, unauthorized } from '../errors.js'
import { asyncHandler, parse, send } from '../http.js'
import { rateLimit } from '../rateLimit.js'
import { createWorkspace, listClients, listMemberClientIds, listMemberships } from '../workspaces.js'
import {
  consumePasswordReset,
  createPasswordReset,
  createUser,
  deletePasswordResetsForUser,
  deleteSessionsForUser,
  findUserByEmail,
  findValidPasswordReset,
  publicBusiness,
  publicUser,
  updateUserPassword,
} from '../repositories.js'

/**
 * @param {{ db: any, config: any, limiters: any }} deps
 */
export function createAuthRouter({ db, config, limiters }) {
  const router = Router()
  const guard = rateLimit({
    limiter: limiters.auth,
    bucket: 'auth',
    message: 'Too many attempts. Please wait a moment before trying again.',
  })

  /** Rate limit keyed by the submitted email, so one mailbox cannot be spammed. */
  const emailGuard = rateLimit({
    limiter: limiters.auth,
    bucket: 'auth',
    keyGenerator: (req) => {
      const email = String(req.body?.email ?? '').trim().toLowerCase()
      return email ? `email:${email}` : `ip:${req.ip ?? 'unknown'}`
    },
    message: 'Too many reset requests for that email. Please wait a moment before trying again.',
  })

  /** Current session, if any. Never throws for anonymous visitors. */
  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      send(res, {
        user: req.user ? publicUser(req.user) : null,
        business: req.business ? publicBusiness(req.business) : null,
        workspace: req.workspace ?? null,
        role: req.role ?? null,
        memberships: req.memberships ?? [],
      })
    }),
  )

  router.post(
    '/signup',
    guard,
    asyncHandler(async (req, res) => {
      const input = parse(signupSchema, req.body)
      const { passwordHash, passwordSalt } = await hashPassword(input.password)
      const user = await createUser(db, {
        email: input.email,
        name: input.name,
        passwordHash,
        passwordSalt,
      })
      // Every account starts with a workspace so clients and projects always
      // have a home; the name can be changed later.
      await createWorkspace(db, { name: input.name, ownerUserId: user.id })
      const { token } = await issueSession(db, user.id, config)
      setSessionCookie(res, token, config)
      send(res, { user: publicUser(user), business: null }, 201)
    }),
  )

  router.post(
    '/login',
    guard,
    asyncHandler(async (req, res) => {
      const input = parse(loginSchema, req.body)
      const user = await findUserByEmail(db, input.email)
      // Always run the comparison so a missing account and a wrong password take
      // the same amount of time, and return the same message either way.
      const dummy = { passwordSalt: 'na', passwordHash: 'na' }
      const target = user ?? dummy
      const ok = await verifyPassword(input.password, target.passwordSalt, target.passwordHash)
      if (!user || !ok) {
        throw unauthorized('Incorrect email or password.')
      }
      // A brand new session row and cookie value are minted here, so a cookie
      // captured before login can never be promoted to an authenticated session.
      const { token } = await issueSession(db, user.id, config)
      setSessionCookie(res, token, config)

      // Resolve the default client through an active workspace membership only.
      // There is deliberately no legacy owner_user_id fallback: a removed member
      // must not receive tenant data just because they created the row.
      const primary = (await listMemberships(db, user.id))[0] ?? null
      let business = null
      if (primary) {
        const allowedClientIds = await listMemberClientIds(db, primary)
        const clients = await listClients(db, primary.workspaceId, allowedClientIds)
        business = clients[0] ?? null
      }
      send(res, { user: publicUser(user), business: publicBusiness(business) })
    }),
  )

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      await revokeSession(db, req.cookies?.[SESSION_COOKIE], config)
      clearSessionCookie(res, config)
      res.status(204).end()
    }),
  )

  /**
   * Password reset — request.
   *
   * The response is identical whether or not an account exists, and the same
   * message is returned for a missing user and a failed send: the endpoint
   * cannot be used to enumerate accounts. Rate limited per submitted email.
   */
  router.post(
    '/forgot-password',
    emailGuard,
    asyncHandler(async (req, res) => {
      const email = String(req.body?.email ?? '').trim().toLowerCase()
      const parsedEmail = emailSchema.safeParse(email)
      if (!parsedEmail.success) {
        throw badRequest('Enter a valid email address.', { email: 'Enter a valid email address.' })
      }

      // One message for every outcome — existence must not be observable.
      const accepted = {
        ok: true,
        message: 'If an account exists for that email, we have sent password reset instructions.',
      }

      const user = await findUserByEmail(db, parsedEmail.data)
      if (!user) {
        send(res, accepted, 202)
        return
      }

      try {
        const token = generateResetToken(config)
        const ttlMinutes = config.resetTokenTtlMinutes
        const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000)
        // A new request invalidates any outstanding tokens for the account.
        await deletePasswordResetsForUser(db, user.id)
        await createPasswordReset(db, {
          userId: user.id,
          tokenHash: hashResetToken(token, config.sessionSecret),
          expiresAt,
        })

        if (!config.appUrl) {
          // Never derive a reset link from the request Host header: an attacker
          // could make the victim receive a token for the attacker's domain.
          throw new Error('APP_URL is required to build password reset links.')
        }
        const origin = String(config.appUrl).replace(/\/$/, '')
        const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`
        const { html, text } = renderResetEmail(resetUrl, ttlMinutes)
        await sendEmail(
          { to: user.email, subject: 'Reset your RaveWall password', html, text },
          {
            resendApiKey: config.resendApiKey,
            emailFrom: config.emailFrom,
            emailTestRecipient: config.emailTestRecipient,
            logger: console,
          },
        )
      } catch (error) {
        // Log the detail; the caller still sees the same generic response.
        console.error('[kudos] password reset request failed', {
          message: error instanceof Error ? error.message : String(error),
        })
      }

      send(res, accepted, 202)
    }),
  )

  /**
   * Password reset — confirm.
   *
   * Validates the token server-side, replaces the password, consumes the token,
   * and ends every existing session for the account (a reset is the natural
   * moment to make sure nobody else stays signed in).
   */
  router.post(
    '/reset-password',
    guard,
    asyncHandler(async (req, res) => {
      const token = String(req.body?.token ?? '')
      const password = String(req.body?.password ?? '')
      if (!token || token.length > 200) {
        throw badRequest('This reset link is invalid.', { token: 'This reset link is invalid.' })
      }
      const passwordResult = passwordSchema.safeParse(password)
      if (!passwordResult.success) {
        // Report the first rule the password breaks — the most useful message.
        const issue = passwordResult.error.issues[0]
        throw badRequest('Please check the highlighted fields.', { password: issue.message })
      }

      const tokenHash = hashResetToken(token, config.sessionSecret)
      const reset = await findValidPasswordReset(db, tokenHash)
      if (!reset) {
        // Invalid, expired or already used — all the same message.
        throw badRequest('This reset link is invalid or has expired.', {
          token: 'This reset link is invalid or has expired.',
        })
      }

      const { passwordHash, passwordSalt } = await hashPassword(passwordResult.data)
      const updated = await updateUserPassword(db, reset.user_id, passwordHash, passwordSalt)
      if (!updated) {
        throw unauthorized('This reset link is invalid or has expired.')
      }

      await consumePasswordReset(db, reset.id)
      await deletePasswordResetsForUser(db, reset.user_id)
      const sessionsEnded = await deleteSessionsForUser(db, reset.user_id)

      send(res, { ok: true, sessionsEnded })
    }),
  )

  return router
}
