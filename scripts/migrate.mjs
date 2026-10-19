/**
 * Applies pending SQL migrations from supabase/migrations.
 *
 *   npm run migrate
 *
 * Uses SUPABASE_MIGRATION_DB_URL when it is set, falling back to SUPABASE_DB_URL.
 * The migration connection matters: `pg_advisory_lock` is session scoped, and
 * Supabase's transaction pooler (port 6543) may route each statement to a
 * different backend, so point the migration URL at the session pooler (5432).
 *
 * Safe to run repeatedly, safe to run concurrently with other instances (the
 * runner takes a Postgres advisory lock), and safe to run while the app is live —
 * each migration is applied in its own transaction.
 *
 * The server also runs migrations on boot, so this command exists for CI, for a
 * deliberate deploy step, and for inspecting what has been applied.
 */
import { loadConfig } from '../src/server/config.js'
import { createDb, listAppliedMigrations, runMigrationsFromConfig } from '../src/server/db.js'

async function main() {
  const config = loadConfig()

  const { applied, skipped } = await runMigrationsFromConfig(config)
  console.log(
    applied.length > 0
      ? `Applied ${applied.length} migration(s): ${applied.join(', ')}`
      : 'No pending migrations.',
  )
  if (skipped > 0) console.log(`${skipped} migration(s) already applied.`)

  // Re-read the history over the same connection type for the summary.
  const db = createDb({
    connectionString: config.migrationDatabaseUrl || config.databaseUrl,
    isProduction: config.isProduction,
    max: 1,
  })
  try {
    const history = await listAppliedMigrations(db)
    for (const row of history) {
      console.log(`  ${row.version}  ${new Date(row.applied_at).toISOString()}`)
    }
  } finally {
    await db.close()
  }
}

main().catch((error) => {
  console.error(`migrate failed: ${error.message}`)
  process.exit(1)
})
