import fs from 'node:fs'
import path from 'node:path'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { attachActor } from './auth.js'
import { createStripeClient } from './billing.js'
import { AppError, notFound } from './errors.js'
import { injectNotFoundMetadata, injectWallMetadata } from './html-meta.js'
import { asyncHandler, originGuard } from './http.js'
import { findPublicWall } from './public-wall.js'
import { PostgresRateLimiter, SlidingWindowLimiter, rateLimit } from './rateLimit.js'
import { listIndexableWalls } from './repositories.js'
import { createAccountRouter } from './routes/account.js'
import { createAuthRouter } from './routes/auth.js'
import { createBillingRouter } from './routes/billing.js'
import { createBusinessRouter } from './routes/business.js'
import { createContentRouter } from './routes/content.js'
import { createPublicRouter } from './routes/public.js'
import { createTestimonialRouter } from './routes/testimonials.js'
import { createWebhookRouter } from './routes/webhooks.js'
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

const XML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => XML_ESCAPES[character])
}

/** Public absolute origin used in canonical URLs and the sitemap. */
function publicOrigin(config) {
  if (!config.appUrl) {
    throw new Error('APP_URL is required to build public absolute URLs.')
  }
  return String(config.appUrl).replace(/\/$/, '')
}

function resolveIndexFile(config) {
  const candidates = [
    path.join(config.staticDir, 'index.html'),
    path.join(process.cwd(), 'dist', 'index.html'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

/**
 * Builds the Express application.
 *
 * Exported separately from the bootstrap so tests can mount it without opening a
 * socket.
 *
 * @param {{ db: any, config: any, logger?: Console, stripe?: any }} deps
 */
export function createApp({ db, config, logger = console, stripe = null }) {
  const app = express()
  const stripeClient = stripe ?? createStripeClient(config)

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
  app.use(
    express.json({
      limit: '64kb',
      // Stripe signs the exact bytes it sent. Keep the raw body for webhook
      // signature verification; every other route uses the parsed object.
      verify: (req, _res, buffer) => {
        if (req.path === '/api/webhooks/stripe') req.rawBody = Buffer.from(buffer)
      },
    }),
  )
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
  api.use('/billing', createBillingRouter({ db, config, stripe: stripeClient }))
  api.use('/webhooks', createWebhookRouter({ db, config, stripe: stripeClient }))
  api.use('/testimonials', createTestimonialRouter({ db }))
  api.use('/workspace', createWorkspaceRouter({ db, config, logger }))
  api.use('/projects', createContentRouter({ db }))
  api.use('/public', createPublicRouter({ db, config, limiters, logger }))
  api.use((_req, _res, next) => next(notFound('Unknown API endpoint.')))

  app.use('/api', api)

  // ------------------------------------------------------------ HTML shell
  const indexFile = resolveIndexFile(config)
  const hasBuild = fs.existsSync(indexFile)
  let indexTemplate = null

  async function readIndexTemplate() {
    if (indexTemplate === null) indexTemplate = await fs.promises.readFile(indexFile, 'utf8')
    return indexTemplate
  }

  // ---------------------------------------------------------------- sitemap
  // Public, cacheable, and generated from the database. Only walls with at
  // least one approved testimonial are listed; a wall with nothing approved is
  // thin content and is also tagged `noindex` by the HTML route below.
  app.get('/sitemap.xml', async (req, res) => {
    try {
      const base = publicOrigin(config)
      const siteLastmod = new Date().toISOString()
      const walls = await listIndexableWalls(db)
      const entries = [
        { loc: `${base}/`, lastmod: siteLastmod, priority: '1.0' },
        { loc: `${base}/pricing`, lastmod: siteLastmod, priority: '0.8' },
        { loc: `${base}/privacy`, lastmod: siteLastmod, priority: '0.3' },
        { loc: `${base}/terms`, lastmod: siteLastmod, priority: '0.3' },
        ...walls.map((wall) => ({
          loc: `${base}/wall/${wall.slug}`,
          lastmod: wall.lastmod ?? siteLastmod,
          priority: '0.8',
        })),
      ]
      const body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...entries.map(
          (entry) =>
            `  <url><loc>${escapeXml(entry.loc)}</loc><lastmod>${escapeXml(
              entry.lastmod,
            )}</lastmod><priority>${entry.priority}</priority></url>`,
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

  // ------------------------------------------------------- wall HTML meta
  // Vercel rewrites /wall/* here so the first response already carries the
  // wall's title, description, canonical and social tags. The SPA bundle then
  // hydrates normally. A missing or malformed slug is a real 404 with
  // `noindex, follow`, never a soft 200.
  app.get(
    '/wall/:slug',
    asyncHandler(async (req, res, next) => {
      if (!hasBuild) return next()

      const origin = publicOrigin(config)
      const template = await readIndexTemplate()
      const wall = await findPublicWall(db, req.params.slug)

      res.set('Cache-Control', 'no-cache')

      if (!wall) {
        return res
          .status(404)
          .type('html')
          .send(injectNotFoundMetadata(template, { origin, path: req.path }))
      }

      return res.type('html').send(
        injectWallMetadata(template, {
          business: wall.business,
          stats: wall.stats,
          origin,
          slug: wall.slug,
        }),
      )
    }),
  )

  // ------------------------------------------------------------ static SPA
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
