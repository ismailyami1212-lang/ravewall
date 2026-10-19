/**
 * Local development server.
 *
 *   npm run dev
 *
 * Runs the real Express app, the real migrations and the real SQL against an
 * in-process PostgreSQL (PGlite) persisted to ./.pglite, so a developer needs no
 * database account to work on the app.
 *
 * This is a development harness, NOT a storage fallback: it refuses to start in
 * production, and `npm start` requires SUPABASE_DB_URL.
 */
import path from 'node:path'
import { createApp } from '../src/server/app.js'
import { projectRoot, loadConfig } from '../src/server/config.js'
import { runMigrations } from '../src/server/db.js'
import { createPgliteDb } from './lib/pglite-db.mjs'

if (process.env.NODE_ENV === 'production') {
  console.error(
    'dev-server is a local development harness and refuses to run with NODE_ENV=production.\n' +
      'Use `npm start` with SUPABASE_DB_URL set instead.',
  )
  process.exit(1)
}

// The local development server must never be able to open a connection to a
// real Supabase project. We deliberately strip any production database
// credentials from the environment and force the in-process PGlite database,
// so even if a stray SUPABASE_DB_URL is exported in the shell it cannot
// reach (or even appear in) the configuration.
const DEV_ENV = {
  ...process.env,
  NODE_ENV: 'development',
  // Placeholders: the connection string is never used, PGlite runs in-process.
  SUPABASE_DB_URL: 'postgresql://local/pglite',
  SUPABASE_MIGRATION_DB_URL: undefined,
  SESSION_SECRET:
    process.env.SESSION_SECRET ?? 'local-development-only-session-secret-please-change',
}
// Belt-and-suspenders: ensure no real connection string survives the spread.
delete DEV_ENV.SUPABASE_MIGRATION_DB_URL

const DATA_DIR = (() => {
  const configured = process.env.PGLITE_DIR
  // PGLITE_DIR=memory keeps the database entirely in RAM, giving a clean schema
  // and a clean rate-limit window on every boot. Used by the smoke test.
  if (configured === 'memory') return null
  if (configured) return path.resolve(projectRoot, configured)
  return path.join(projectRoot, '.pglite')
})()

async function main() {
  const config = loadConfig(DEV_ENV)
  const logger = console

  const db = await createPgliteDb(DATA_DIR ? { dataDir: DATA_DIR } : {})
  await db.ping()
  await runMigrations(db, { logger })

  const app = createApp({ db, config, logger })
  const server = app.listen(config.port, config.host, () => {
    logger.log(
      `[kudos] development server on http://localhost:${config.port} — ` +
        (DATA_DIR ? `in-process Postgres at ${DATA_DIR}` : 'in-process Postgres in memory'),
    )
  })

  const shutdown = () => {
    server.close(() => db.close().then(() => process.exit(0)))
    setTimeout(() => process.exit(0), 5_000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error(`[kudos] development server failed to start: ${error.message}`)
  process.exit(1)
})
