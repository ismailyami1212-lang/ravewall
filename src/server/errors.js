/**
 * Application error type.
 *
 * Every failure that should reach the client as a structured response is
 * expressed as an AppError; anything else is treated as an internal error and
 * its message is withheld from the client.
 */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code stable machine readable code
   * @param {string} message safe, user facing message
   * @param {Record<string, string>} [fields] per-field validation messages
   */
  constructor(status, code, message, fields) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.fields = fields
    this.expose = true
  }
}

export const badRequest = (message, fields) => new AppError(400, 'bad_request', message, fields)
export const unauthorized = (message = 'Please sign in to continue.') =>
  new AppError(401, 'unauthorized', message)
export const forbidden = (message = 'You do not have access to that resource.') =>
  new AppError(403, 'forbidden', message)
export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message)
export const conflict = (message, fields) => new AppError(409, 'conflict', message, fields)
export const tooManyRequests = (message) => new AppError(429, 'rate_limited', message)

/**
 * Wraps a database failure. The underlying error is logged by the caller with
 * full detail; the client only learns that the service is unavailable, never the
 * driver message, which can contain host names or SQL fragments.
 */
export const databaseUnavailable = (cause) => {
  const error = new AppError(
    503,
    'database_unavailable',
    'The service is temporarily unavailable. Please try again in a moment.',
  )
  error.cause = cause
  error.expose = true
  return error
}
