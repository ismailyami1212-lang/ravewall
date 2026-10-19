import { badRequest, forbidden } from './errors.js'
import { validate } from '../shared/validation.js'

/** Wraps an async route handler so rejections reach the error middleware. */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)

/**
 * Parses input with a shared schema and converts failures into a 400 carrying
 * per-field messages. This is the server-side trust boundary — the browser runs
 * the same schema only for convenience.
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown} input
 * @returns {T}
 */
export function parse(schema, input) {
  const result = validate(schema, input)
  if (!result.ok) {
    throw badRequest('Please check the highlighted fields.', result.errors)
  }
  return result.data
}

/**
 * Rejects state-changing requests that carry an Origin we do not trust.
 *
 * Combined with the SameSite=Lax session cookie this blocks cross-site request
 * forgery without needing a token round trip. Requests without an Origin header
 * (native fetch from a script, curl, health probes) are allowed through — they
 * cannot carry a victim's cookie implicitly.
 */
export function originGuard(config) {
  const configured = new Set(config.allowedOrigins)
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    const origin = req.get('origin')
    if (!origin) return next()
    const host = req.get('host')
    const sameOrigin = [`http://${host}`, `https://${host}`]
    const normalised = origin.replace(/\/$/, '')
    if (configured.has(normalised) || sameOrigin.includes(normalised)) return next()
    next(forbidden('This request was blocked because it came from an untrusted origin.'))
  }
}

/** Sends a successful JSON envelope. */
export function send(res, payload, status = 200) {
  res.status(status).json({ data: payload })
}
