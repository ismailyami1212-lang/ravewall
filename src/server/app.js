import fs from 'node:fs'
import path from 'node:path'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { attachActor } from './auth.js'
import { AppError, notFound } from './errors.js'
import { originGuard } from './http.js'
import { PostgresRateLimiter, SlidingWindowLimiter, rateLimit } from './rateLimit.js'
import { listWallSlugs } from './repositories.js'
import { createAccountRouter } from './routes/account.js'
import { createAuthRouter } from './routes/auth.js'
import { createBusinessRouter } from './routes/business.js'
import { createContentRouter } from './routes/content.js'
import { createPublicRouter } from './routes/public.js'
import { createTestimonialRouter } from './routes/testimonials.js'
import { createWorkspaceRouter } from './routes/workspace.js'

/**
 * Postgres codes that mean "the database is not reachable right now" rather than
 * "this statement is wrong". These surface as 503 so a client can retry, and the
 * driver message never reaches the response body.
 */
const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
])

const POSTGRES_CODE = /^[0-9A-Z]{5}$/

/**
 * Builds the Express application.
 *
 * Exported separately from the bootstrap so tests can mount it without opening a
 * socket.
 *
 * @param {{ db: any, config: any, logger?: Console }} deps
 */
export function createApp({ db, config, logger = console }) {
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy ? 1 : false)
  app.set('etag', 'strong')

  const limiters = {
    // Login, signup and public submission are counted in Postgres so the limits
    // survive restarts and hold across instances.
    auth: new PostgresRateLimiter({ db, bucket: 'auth', logger, ...config.rateLimits.auth }),
    submit: new PostgresRateLimiter({ db, bucket: 'submit', logger, ...config.rateLimits.submit }),
    // The general API bucket stays in-process: generous ceiling, best effort.
    api: new SlidingWindowLimiter(config.rateLimits.api),
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          // React sets a handful of inline style attributes (accent colours).
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: config.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  )
  app.use(compression())
  app.use(express.json({ limit: '64kb' }))
  app.use(cookieParser())

  // ------------------------------------------------------------------ CORS
  // Embeddable assets must load from third-party sites (the widget script is
  // included on customer websites). Helmet's default
  // Cross-Origin-Resource-Policy: same-origin would block exactly that, so the
  // widget bundle opts out. Only the static /widget/ path is affected; the API
  // is fetched same-origin by the script itself.
  app.use((req, res, next) => {
    if (req.path.startsWith('/widget/')) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    }
    next()
  })

  // --------------------------------------------------------------------- API
  const api = express.Router()
  api.use(originGuard(config))
  api.use(rateLimit({ limiter: limiters.api, bucket: 'api' }))
  // Mounted here rather than globally: static assets and the SPA shell must not
  // cost a database round trip.
  api.use(attachActor(db, config))

  api.get('/health', async (_req, res) => {
    const base = {
      uptimeSeconds: Math.round(process.uptime()),
      environment: config.nodeEnv,
      time: new Date().toISOString(),
    }
    try {
      await db.ping()
      res.json({ data: { status: 'ok', database: 'ok', ...base } })
    } catch (error) {
      logger.error('[kudos] health check failed', { message: error.message })
      // No driver detail, host name or credential is included.
      res.status(503).json({ data: { status: 'degraded', database: 'unavailable', ...base } })
    }
  })

  api.use('/auth', createAuthRouter({ db, config, limiters }))
  api.use('/account', createAccountRouter({ db, config, limiters }))
  api.use('/business', createBusinessRouter({ db }))
  api.use('/testimonials', createTestimonialRouter({ db }))
  api.use('/workspace', createWorkspaceRouter({ db }))
  api.use('/projects', createContentRouter({ db }))
  api.use('/public', createPublicRouter({ db, config, limiters }))
  api.use((_req, _res, next) => next(notFound('Unknown API endpoint.')))

  app.use('/api', api)

  // ---------------------------------------------------------------- sitemap
  // Public, cacheable, and generated from the database so every public wall is
  // listed. Slugs are CHECK-constrained to `[a-z0-9-]`, so no escaping is
  // needed. Served through the /api/handler rewrite on Vercel.
  app.get('/sitemap.xml', async (req, res) => {
    try {
      const origin = config.appUrl ?? `https://${req.get('host')}`
      const base = origin.replace(/\/$/, '')
      const slugs = await listWallSlugs(db)
      const entries = [
        { loc: `${base}/`, priority: '1.0' },
        { loc: `${base}/pricing`, priority: '0.8' },
        { loc: `${base}/privacy`, priority: '0.3' },
        { loc: `${base}/terms`, priority: '0.3' },
        ...slugs.map((slug) => ({ loc: `${base}/wall/${slug}`, priority: '0.8' })),
      ]
      const body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...entries.map(
          (entry) => `  <url><loc>${entry.loc}</loc><priority>${entry.priority}</priority></url>`,
        ),
        '</urlset>',
      ].join('\n')
      res.set('Cache-Control', 'public, max-age=300, s-maxage=3600')
      res.type('application/xml').send(body)
    } catch (error) {
      // A sitemap failure must never look like an application outage.
      logger.error('[kudos] sitemap generation failed', { message: error.message })
      res.type('application/xml').status(503).send('<?xml version="1.0"?><error>unavailable</error>')
    }
  })

  // ------------------------------------------------------------ static SPA
  const indexFile = path.join(config.staticDir, 'index.html')
  const hasBuild = fs.existsSync(indexFile)

  if (hasBuild) {
    app.use(
      express.static(config.staticDir, {
        index: false,
        etag: true,
        maxAge: '1y',
        immutable: true,
        setHeaders(res, filePath) {
          // The HTML shell must always be revalidated; hashed assets are immutable.
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
        },
      }),
    )
  }

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    if (!hasBuild) {
      return res
        .status(503)
        .type('text/plain')
        .send(
          'The client bundle has not been built yet.\n\n' +
            'Run `npm run build` (or `npm run dev` for the development servers), then reload.',
        )
    }
    return res.sendFile(indexFile)
  })

  // -------------------------------------------------------------- errors
  app.use((req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } })
  })

  app.use((error, req, res, _next) => {
    if (res.headersSent) return

    const logContext = { method: req.method, path: req.path }

    if (error instanceof AppError) {
      if (error.cause) {
        logger.error('[kudos] database error', {
          ...logContext,
          code: error.cause.code ?? null,
          message: error.cause.message,
        })
      }
      return res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      })
    }

    // Body parser failures (malformed or oversized JSON).
    if (error.type === 'entity.parse.failed') {
      return res
        .status(400)
        .json({ error: { code: 'bad_request', message: 'Request body is not valid JSON.' } })
    }
    if (error.type === 'entity.too.large') {
      return res
        .status(413)
        .json({ error: { code: 'payload_too_large', message: 'Request body is too large.' } })
    }

    // Any other error that explicitly opted into being shown to the client.
    if (error.expose === true && Number.isInteger(error.status)) {
      return res.status(error.status).json({
        error: { code: error.code ?? 'error', message: error.message },
      })
    }

    // A lost database connection is an outage, not a bug: report it as retryable.
    if (UNAVAILABLE_CODES.has(String(error.code))) {
      logger.error('[kudos] database unavailable', {
        ...logContext,
        code: error.code,
        message: error.message,
      })
      return res.status(503).json({
        error: {
          code: 'database_unavailable',
          message: 'The service is temporarily unavailable. Please try again in a moment.',
        },
      })
    }

    // Anything else is ours to fix. Log the detail, tell the client nothing.
    logger.error('[kudos] unhandled request error', {
      ...logContext,
      code: error.code ?? null,
      postgres: POSTGRES_CODE.test(String(error.code ?? '')) ? error.code : undefined,
      message: error.message,
    })
    return res
      .status(500)
      .json({ error: { code: 'internal_error', message: 'Something went wrong on our side.' } })
  })

  return app
}
