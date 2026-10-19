/**
 * Removes test accounts left behind by scripts/smoke-production.mjs.
 *
 *   npm run smoke:cleanup
 *
 * The production smoke test defers account cleanup to this script. It deletes
 * ONLY users whose email matches the smoke patterns (smoke-*@example.com,
 * intruder-*@example.com). Foreign keys cascade (businesses, testimonials,
 * sessions), so removing the users removes their residue. A dry run prints
 * the targets first; the delete runs only with --yes.
 */
import { loadConfig } from '../src/server/config.js'
import { createDb } from '../src/server/db.js'

const APPLY = process.argv.includes('--yes')
const PATTERN = `email ~ '^(smoke|intruder)-[0-9]+@example\\.com$'`

async function main() {
  const config = loadConfig()
  const db = createDb(
    {
      connectionString: config.migrationDatabaseUrl,
      isProduction: config.isProduction,
      max: 1,
      applicationName: 'ravewall-smoke-cleanup',
    },
    { log() {}, warn() {}, error() {} },
  )

  try {
    await db.ping()

    const targets = await db.query(
      `SELECT id, email, name FROM users WHERE ${PATTERN} ORDER BY created_at`,
    )

    console.log(`smoke accounts matched: ${targets.rows.length}`)
    for (const user of targets.rows) {
      console.log(`  ${user.email} (${user.name})`)
    }

    if (targets.rows.length === 0) {
      console.log('nothing to clean')
      return
    }

    if (!APPLY) {
      console.log('dry run — re-run with --yes to delete these accounts (cascades to their data)')
      return
    }

    const ids = targets.rows.map((row) => row.id)
    const businesses = await db.query(
      'SELECT count(*)::int AS n FROM businesses WHERE owner_user_id = ANY($1::uuid[])',
      [ids],
    )
    const deleted = await db.query(`DELETE FROM users WHERE ${PATTERN}`)

    const remainingUsers = await db.query('SELECT count(*)::int AS n FROM users')
    const remainingBusinesses = await db.query('SELECT count(*)::int AS n FROM businesses')
    console.log(
      `deleted ${deleted.rowCount} user(s) and ${businesses.rows[0].n} business(es) via cascade`,
    )
    console.log(
      `remaining: ${remainingUsers.rows[0].n} user(s), ${remainingBusinesses.rows[0].n} business(es)`,
    )
  } finally {
    await db.close?.()
  }
}

main().catch((error) => {
  console.error(`cleanup failed: ${error.message}`)
  process.exitCode = 1
})
