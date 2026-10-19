/**
 * Verifies a real Supabase deployment.
 *
 *   npm run verify:deployment
 *
 * Connects with the migration connection (SUPABASE_MIGRATION_DB_URL, falling back
 * to SUPABASE_DB_URL) and checks that the schema, indexes, functions,
 * constraints and row-level-security state actually exist in the hosted
 * database — not just that the migration files were written.
 *
 * Prints PASS/FAIL per check. Never prints a connection string, a password or
 * any other secret.
 */
import { loadConfig } from '../src/server/config.js'
import { createDb, listAppliedMigrations } from '../src/server/db.js'

const results = []

function record(label, ok, detail = '') {
  results.push({ label, ok, detail })
  const status = ok ? 'PASS' : 'FAIL'
  console.log(`  ${status}  ${label}${detail && !ok ? ` — ${detail}` : ''}`)
}

/** Runs one scalar query and returns the single value. */
async function scalar(db, sql, params = []) {
  const { rows } = await db.query(sql, params)
  const row = rows[0]
  return row ? Object.values(row)[0] : undefined
}

async function main() {
  const config = loadConfig()
  const target = new URL(config.migrationDatabaseUrl)
  const usingSeparate = config.usesSeparateMigrationUrl

  console.log('Supabase deployment verification')
  // The host carries the project reference, so it is never printed. The port and
  // database name are enough to confirm the right connection string was used.
  console.log(
    `  target: port ${target.port}  database ${target.pathname.slice(1)}  ` +
      `pooler ${/supabase/i.test(target.hostname) ? 'yes' : 'no'}  (host redacted)`,
  )
  console.log(`  migration connection: ${usingSeparate ? 'separate (session)' : 'same as runtime'}`)
  console.log('')

  const db = createDb(
    {
      connectionString: config.migrationDatabaseUrl,
      isProduction: config.isProduction,
      max: 1,
      applicationName: 'kudos-verify',
    },
    { log() {}, warn() {}, error() {} },
  )

  try {
    // ---------------------------------------------------------------- connect
    try {
      await db.ping()
      record('database reachable', true)
    } catch (error) {
      record('database reachable', false, error.message)
      throw new Error('cannot continue without a database connection')
    }

    const version = await scalar(db, 'SELECT version()')
    record('postgres server', typeof version === 'string' && version.startsWith('PostgreSQL'), version)

    // ------------------------------------------------------------- migrations
    const applied = await listAppliedMigrations(db).catch(() => null)
    if (!applied) {
      record('migrations applied', false, 'schema_migrations table missing — run `npm run migrate`')
    } else {
      const versions = applied.map((row) => row.version)
      for (const expected of ['0001_initial.sql', '0002_rate_limiting.sql']) {
        record(`migration applied: ${expected}`, versions.includes(expected), `found: ${versions.join(', ') || 'none'}`)
      }
    }

    // ----------------------------------------------------------------- tables
    const expectedTables = [
      'users',
      'businesses',
      'testimonials',
      'sessions',
      'rate_limit_hits',
      'schema_migrations',
      // 0005 — agency model
      'workspaces',
      'workspace_members',
      'workspace_member_clients',
      'projects',
      'custom_questions',
      'tags',
      'testimonial_tags',
      'widget_configs',
    ]
    const { rows: tableRows } = await db.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    )
    const tables = new Set(tableRows.map((row) => row.tablename))
    for (const table of expectedTables) {
      record(`table exists: ${table}`, tables.has(table))
    }

    // ---------------------------------------------------------------- indexes
    const expectedIndexes = [
      'users_email_unique',
      'businesses_slug_idx',
      'businesses_owner_idx',
      'businesses_slug_unique',
      'businesses_workspace_idx',
      'testimonials_business_status_created_idx',
      'testimonials_business_created_idx',
      'testimonials_business_created_at_idx',
      'testimonials_project_status_created_idx',
      'testimonials_project_created_idx',
      'sessions_token_hash_unique',
      'sessions_expires_at_idx',
      'sessions_user_id_idx',
      'rate_limit_hits_lookup_idx',
      // 0005 — agency model
      'workspace_members_user_idx',
      'workspace_members_workspace_idx',
      'projects_business_idx',
      'projects_workspace_idx',
      'custom_questions_project_idx',
      'tags_workspace_idx',
      'testimonial_tags_tag_idx',
      'widget_configs_project_idx',
      // 0006 — saved widgets
      'widget_configs_project_status_idx',
    ]
    const { rows: indexRows } = await db.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    )
    const indexes = new Set(indexRows.map((row) => row.indexname))
    for (const index of expectedIndexes) {
      record(`index exists: ${index}`, indexes.has(index))
    }

    // -------------------------------------------------------------- functions
    const { rows: functionRows } = await db.query(
      `SELECT proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'`,
    )
    const functions = new Set(functionRows.map((row) => row.proname))
    for (const fn of ['set_updated_at', 'rate_limit_hit']) {
      record(`function exists: ${fn}`, functions.has(fn))
    }

    // The limiter function must be callable, not merely present.
    if (functions.has('rate_limit_hit')) {
      try {
        const { rows } = await db.query(
          'SELECT allowed, remaining, retry_after_ms FROM rate_limit_hit($1, $2, $3, $4)',
          ['verify', `probe-${Date.now()}`, 60_000, 3],
        )
        record('rate_limit_hit() callable', rows[0]?.allowed === true && rows[0]?.remaining === 2)
      } catch (error) {
        record('rate_limit_hit() callable', false, error.message)
      }
    }

    // ------------------------------------------------------------ constraints
    const expectedConstraints = [
      'users_email_lowercase',
      'users_email_unique',
      'businesses_slug_format',
      'businesses_accent_color_format',
      'businesses_slug_unique',
      // 0005 — the single-owner restriction is gone by design (workspaces own
      // businesses now); these are the new integrity guards.
      'workspace_members_role_valid',
      'workspace_members_status_valid',
      'workspace_members_unique',
      'projects_name_length',
      'projects_slug_format',
      'projects_slug_length',
      'projects_slug_unique',
      'custom_questions_label_length',
      'custom_questions_type_valid',
      'tags_name_length',
      'tags_workspace_name_unique',
      'widget_configs_name_length',
      'widget_configs_layout_valid',
      'widget_configs_theme_valid',
      'widget_configs_accent_format',
      'widget_configs_max_items_range',
      // 0006 — saved widgets
      'widget_configs_public_id_unique',
      'widget_configs_status_valid',
      'testimonials_rating_range',
      'testimonials_status_valid',
      'testimonials_content_length',
      'sessions_token_hash_unique',
    ]
    const { rows: constraintRows } = await db.query(
      `SELECT conname FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public'`,
    )
    const constraints = new Set(constraintRows.map((row) => row.conname))
    for (const constraint of expectedConstraints) {
      record(`constraint exists: ${constraint}`, constraints.has(constraint))
    }

    // -------------------------------------------------------------------- RLS
    const appTables = [
      'users',
      'businesses',
      'testimonials',
      'sessions',
      'rate_limit_hits',
      // 0005 — agency tables are RLS-on, no API-role grants
      'workspaces',
      'workspace_members',
      'workspace_member_clients',
      'projects',
      'custom_questions',
      'tags',
      'testimonial_tags',
      'widget_configs',
    ]
    const { rows: rlsRows } = await db.query(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY($1)`,
      [appTables],
    )
    const rls = new Map(rlsRows.map((row) => [row.relname, row.relrowsecurity]))
    for (const table of appTables) {
      record(`RLS enabled: ${table}`, rls.get(table) === true)
    }

    const { rows: policyRows } = await db.query(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public'`,
    )
    record(
      'no permissive policies (deny by default)',
      policyRows.length === 0,
      `${policyRows.length} policy/policies found`,
    )

    // ------------------------------------------- Supabase API roles are locked
    const { rows: roleRows } = await db.query(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`,
    )
    if (roleRows.length === 0) {
      record('anon/authenticated roles absent (not a Supabase database)', true)
    } else {
      for (const table of appTables) {
        const { rows } = await db.query(
          `SELECT
             has_table_privilege('anon', $1, 'SELECT')          AS anon_select,
             has_table_privilege('authenticated', $1, 'SELECT') AS auth_select`,
          [`public.${table}`],
        )
        const row = rows[0]
        record(
          `API roles cannot read ${table}`,
          row.anon_select === false && row.auth_select === false,
        )
      }
    }

    // ------------------------------------------------------- data sanity check
    const counts = await db.query(
      `SELECT
         (SELECT count(*)::int FROM users)        AS users,
         (SELECT count(*)::int FROM businesses)   AS businesses,
         (SELECT count(*)::int FROM testimonials) AS testimonials`,
    )
    const { users, businesses, testimonials } = counts.rows[0]
    console.log(`\n  data: ${users} user(s), ${businesses} business(es), ${testimonials} testimonial(s)`)
    if (users === 0) {
      console.log('  note: database is empty, which is expected for a clean production start')
    }
  } finally {
    await db.close()
  }

  const failed = results.filter((result) => !result.ok)
  console.log('')
  console.log(`  ${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) {
    console.log(`  FAILED: ${failed.map((result) => result.label).join('; ')}`)
    process.exit(1)
  }
  console.log('  RESULT: PASS')
}

main().catch((error) => {
  console.error(`\n  RESULT: FAIL — ${error.message}`)
  process.exit(1)
})
