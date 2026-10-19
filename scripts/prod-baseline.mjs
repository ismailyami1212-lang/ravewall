/**
 * Read-only production baseline for the RaveWall migration.
 *
 *   npm run prod:baseline
 *
 * Connects with the migration connection (SUPABASE_MIGRATION_DB_URL, falling
 * back to SUPABASE_DB_URL) and prints only non-sensitive aggregates: row
 * counts, business slugs and stored accent colours, plus the applied
 * migration versions. Never mutates data and never prints PII (no emails,
 * names or testimonial contents).
 */
import { loadConfig } from '../src/server/config.js'
import { createDb, listAppliedMigrations } from '../src/server/db.js'

function rowCount(table) {
  return `SELECT count(*)::int AS n FROM ${table}`
}

async function main() {
  const config = loadConfig()
  const db = createDb(
    {
      connectionString: config.migrationDatabaseUrl,
      isProduction: config.isProduction,
      max: 1,
      applicationName: 'ravewall-baseline',
    },
    { log() {}, warn() {}, error() {} },
  )

  try {
    await db.ping()

    const users = await db.query(rowCount('users'))
    const businesses = await db.query(rowCount('businesses'))
    const testimonials = await db.query(rowCount('testimonials'))
    const sessions = await db.query(rowCount('sessions'))
    const pending = await db.query(
      `SELECT count(*)::int AS n FROM testimonials WHERE status = 'pending'`,
    )
    const approved = await db.query(
      `SELECT count(*)::int AS n FROM testimonials WHERE status = 'approved'`,
    )

    console.log('RaveWall production baseline (read-only)')
    console.log(`  users:        ${users.rows[0].n}`)
    console.log(`  businesses:   ${businesses.rows[0].n}`)
    console.log(`  testimonials: ${testimonials.rows[0].n} (${approved.rows[0].n} approved, ${pending.rows[0].n} pending)`)
    console.log(`  sessions:     ${sessions.rows[0].n}`)

    const { rows } = await db.query(
      'SELECT slug, accent_color FROM businesses ORDER BY created_at ASC',
    )
    for (const business of rows) {
      console.log(`  business: ${business.slug}  accent ${business.accent_color}`)
    }

    const migrations = await listAppliedMigrations(db)
    console.log(`  applied migrations: ${migrations.map((m) => m.version ?? m).join(', ')}`)
  } finally {
    await db.close?.()
  }
}

main().catch((error) => {
  console.error(`baseline failed: ${error.message}`)
  process.exitCode = 1
})
