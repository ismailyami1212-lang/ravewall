/**
 * Rate limiting.
 *
 * Two implementations behind one `hit(key)` contract:
 *
 * - `SlidingWindowLimiter` — in-process, dependency free. Cheap, but per
 *   instance: a restart or a second instance resets it. Used for the general API
 *   bucket, where the ceiling is generous and best-effort enforcement is fine.
 * - `PostgresRateLimiter` — the counter lives in Postgres (`rate_limit_hit()`),
 *   so login, signup and public submission stay limited across restarts, deploys
 *   and multiple instances. No Redis, no extra infrastructure.
 *
 * A limiter failure is never allowed to take the API down: `hit()` fails open
 * and logs, because every route that matters will fail closed on its own
 * database access anyway.
 */
import { tooManyRequests } from './errors.js'

export class SlidingWindowLimiter {
  /**
   * @param {{ windowMs: number, max: number }} options
   */
  constructor({ windowMs, max }) {
    this.windowMs = windowMs
    this.max = max
    /** @type {Map<string, number[]>} */
    this.buckets = new Map()
    this.lastSweep = Date.now()
  }

  /**
   * Records a hit and reports whether it is allowed.
   * @param {string} key
   * @param {number} [now]
   */
  hit(key, now = Date.now()) {
    const cutoff = now - this.windowMs
    const hits = (this.buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff)

    if (hits.length >= this.max) {
      const retryAfterMs = Math.max(1, hits[0] + this.windowMs - now)
      this.buckets.set(key, hits)
      this.maybeSweep(now)
      return { allowed: false, remaining: 0, retryAfterMs, limit: this.max }
    }

    hits.push(now)
    this.buckets.set(key, hits)
    this.maybeSweep(now)
    return {
      allowed: true,
      remaining: Math.max(0, this.max - hits.length),
      retryAfterMs: 0,
      limit: this.max,
    }
  }

  /** Drops expired buckets at most once per window. */
  maybeSweep(now) {
    if (now - this.lastSweep < this.windowMs) return
    this.lastSweep = now
    const cutoff = now - this.windowMs
    for (const [key, hits] of this.buckets) {
      const live = hits.filter((timestamp) => timestamp > cutoff)
      if (live.length === 0) this.buckets.delete(key)
      else this.buckets.set(key, live)
    }
  }

  reset() {
    this.buckets.clear()
    this.lastSweep = Date.now()
  }
}

/** How long idle counter rows are kept before pruning. */
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000

export class PostgresRateLimiter {
  /**
   * @param {{ db: any, bucket: string, windowMs: number, max: number, logger?: Console }} options
   */
  constructor({ db, bucket, windowMs, max, logger = console }) {
    this.db = db
    this.bucket = bucket
    this.windowMs = windowMs
    this.max = max
    this.logger = logger
  }

  /**
   * Records a hit in Postgres and reports whether it is allowed.
   * Fails open (with a warning) when the database is unreachable.
   * @param {string} key
   */
  async hit(key) {
    try {
      const { rows } = await this.db.query(
        'SELECT allowed, remaining, retry_after_ms FROM rate_limit_hit($1, $2, $3, $4)',
        [this.bucket, key, this.windowMs, this.max],
      )
      const row = rows[0]
      if (!row) {
        return { allowed: true, remaining: this.max, retryAfterMs: 0, limit: this.max }
      }
      return {
        allowed: row.allowed === true,
        remaining: Number(row.remaining ?? 0),
        retryAfterMs: Number(row.retry_after_ms ?? 0),
        limit: this.max,
      }
    } catch (error) {
      this.logger.warn('[kudos] rate limiter unavailable, request allowed', {
        bucket: this.bucket,
        message: error.message,
      })
      return { allowed: true, remaining: this.max, retryAfterMs: 0, limit: this.max }
    }
  }

  /** Removes counters for keys that have not been seen recently. */
  async prune(maxAgeMs = PRUNE_AFTER_MS) {
    const { rowCount } = await this.db.query('DELETE FROM rate_limit_hits WHERE created_at < $1', [
      new Date(Date.now() - maxAgeMs),
    ])
    return rowCount
  }
}

export function clientKey(req) {
  // `trust proxy` must be enabled for req.ip to be the real client address.
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

/**
 * Express middleware factory. Works with either limiter; the result is awaited so
 * both the synchronous and the database-backed implementations share one path.
 * @param {{ limiter: { hit: (key: string) => any }, bucket: string, keyGenerator?: (req: import('express').Request) => string, message?: string }} options
 */
export function rateLimit({ limiter, bucket, keyGenerator = clientKey, message }) {
  return async (req, res, next) => {
    try {
      const key = `${bucket}:${keyGenerator(req)}`
      const result = await limiter.hit(key)
      res.setHeader('X-RateLimit-Limit', String(result.limit))
      res.setHeader('X-RateLimit-Remaining', String(result.remaining))
      if (!result.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000))
        res.setHeader('Retry-After', String(retryAfterSeconds))
        const wait =
          retryAfterSeconds > 60
            ? `${Math.ceil(retryAfterSeconds / 60)} minute(s)`
            : `${retryAfterSeconds} second(s)`
        return next(tooManyRequests(message ?? `Too many requests. Please try again in ${wait}.`))
      }
      return next()
    } catch (error) {
      return next(error)
    }
  }
}
