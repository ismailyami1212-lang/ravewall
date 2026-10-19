/**
 * Vercel serverless entry point for the API.
 *
 * A catch-all under `api/` so Vercel's file-system routing hands us every
 * `/api/**` request with its original path intact — Express then routes it
 * normally, with no rewrite gymnastics.
 *
 * The pool and the Express app are built once per warm instance and reused.
 * Static assets and the SPA shell never reach this function; see vercel.json.
 *
 * This function does **not** run migrations. Applying them on cold start would
 * make a schema change a side effect of a request, race across instances, and
 * slow every cold start. Migrations are an administrative step
 * (`npm run migrate`), and boot only verifies the schema is present.
 *
 * The runtime therefore needs just two secrets: SUPABASE_DB_URL and
 * SESSION_SECRET. SUPABASE_MIGRATION_DB_URL is deliberately not required here.
 */
import { createApp } from '../src/server/app.js'
import { loadConfig } from '../src/server/config.js'
import { assertSchemaReady, createDb } from '../src/server/db.js'

async function bootstrap() {
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

  await db.ping()
  await assertSchemaReady(db)

  return createApp({ db, config, logger })
}

/**
 * Builds the request handler.
 *
 * The bootstrap is injectable so the adapter itself can be tested without a live
 * database. The promise is cached per warm instance; a failed bootstrap is not
 * cached, so the next request retries instead of serving a permanent 503.
 *
 * @param {() => Promise<any>} [bootstrapFn]
 */
export function createServerlessHandler(bootstrapFn = bootstrap) {
  let ready = null

  return async function handler(req, res) {
    try {
      if (!ready) ready = bootstrapFn()
      const app = await ready
      return app(req, res)
    } catch (error) {
      // A failed cold start must not leak the connection string or a stack trace.
      ready = null
      console.error(`[kudos] serverless bootstrap failed: ${error.message}`)
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          error: {
            code: 'database_unavailable',
            message: 'The service is temporarily unavailable. Please try again in a moment.',
          },
        }),
      )
      return undefined
    }
  }
}

export default createServerlessHandler()
