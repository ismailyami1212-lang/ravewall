/**
 * HTTP server bootstrap.
 *
 * Boot order is deliberate and fails closed:
 *   1. validate the environment (throws on anything missing);
 *   2. open the Postgres pool and prove it works with a ping;
 *   3. confirm the schema is present (migrations are a separate admin step);
 *   4. only then start listening.
 *
 * A missing or unreachable database stops the process. There is no fallback
 * storage: serving traffic without durable persistence would silently lose
 * customer data.
 *
 * This process never applies migrations. Run `npm run migrate` as part of a
 * deploy — a schema change should not be a side effect of starting the app.
 */
import { createApp } from './app.js'
import { sweepSessions } from './auth.js'
import { loadConfig } from './config.js'
import { assertSchemaReady, createDb } from './db.js'
import { describeEmailMode } from './email.js'
import { PostgresRateLimiter } from './rateLimit.js'

const SWEEP_INTERVAL_MS = 60 * 60 * 1000

async function main() {
  const logger = console
  const config = loadConfig()

  const db = createDb(
    {
      connectionString: config.databaseUrl,
      isProduction: config.isProduction,
      max: config.poolMax,
    },
    logger,
  )

  // Prove the connection that will serve traffic works before doing anything else.
  try {
    await db.ping()
  } catch (error) {
    logger.error('[kudos] database connection failed', { message: error.message })
    throw new Error('Cannot reach the database. Check SUPABASE_DB_URL and network access.')
  }

  await assertSchemaReady(db)
  logger.log('[kudos] database schema is present')

  // Make the email mode explicit at boot: a test sender is never silently
  // mistaken for a production-ready one.
  const emailMode = describeEmailMode(config)
  if (emailMode.mode === 'test-sender') {
    logger.warn(
      '[kudos] email: TEST SENDER active (onboarding@resend.dev). Resend only delivers to the ' +
        'account owner address. Set EMAIL_FROM on a verified domain before inviting real users.',
    )
  } else if (emailMode.mode === 'development') {
    logger.log('[kudos] email: development transport (messages are logged, not sent)')
  } else {
    logger.log('[kudos] email: verified domain sender active')
  }

  const app = createApp({ db, config, logger })

  const server = app.listen(config.port, config.host, () => {
    logger.log(
      `[kudos] listening on http://${config.host}:${config.port} (${config.nodeEnv}) — ` +
        `postgres ${describeTarget(config.databaseUrl)}`,
    )
  })

  server.keepAliveTimeout = 65_000
  server.headersTimeout = 70_000

  const rateLimiters = [
    new PostgresRateLimiter({ db, bucket: 'auth', logger, ...config.rateLimits.auth }),
    new PostgresRateLimiter({ db, bucket: 'submit', logger, ...config.rateLimits.submit }),
  ]

  const sweep = setInterval(async () => {
    try {
      const sessions = await sweepSessions(db)
      let pruned = 0
      for (const limiter of rateLimiters) pruned += await limiter.prune()
      if (sessions > 0 || pruned > 0) {
        logger.log(`[kudos] swept ${sessions} expired session(s), ${pruned} rate limit row(s)`)
      }
    } catch (error) {
      logger.error('[kudos] background sweep failed', { message: error.message })
    }
  }, SWEEP_INTERVAL_MS)
  sweep.unref()

  const shutdown = (signal) => {
    logger.log(`[kudos] ${signal} received, shutting down`)
    clearInterval(sweep)
    server.close(() => {
      db.close()
        .then(() => process.exit(0))
        .catch(() => process.exit(0))
    })
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

/**
 * Describes the database target for the boot log.
 *
 * Deliberately prints no credentials and no hostname: the host can carry a
 * project reference, and the connection string is a secret. The port and
 * database name are enough to tell "which database am I on".
 */
function describeTarget(connectionString) {
  try {
    const url = new URL(connectionString)
    return `port ${url.port || '5432'}, database ${url.pathname.slice(1) || 'default'}`
  } catch {
    return 'configured'
  }
}

main().catch((error) => {
  console.error(`[kudos] failed to start: ${error.message}`)
  process.exit(1)
})
