/**
 * Postgres connection handling and the migration runner.
 *
 * The API is the only database client. It connects with a server-side
 * connection string that never reaches the browser, so no Supabase publishable
 * key, service-role key or database password is ever shipped to the client.
 *
 * The adapter exposed here is intentionally tiny — `query`, `exec`,
 * `transaction`, `withConnection`, `ping`, `close` — so the repositories can be
 * exercised against a real PostgreSQL in tests without a second implementation.
 */
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg

/** Advisory lock key guarding the migration run across concurrent instances. */
const MIGRATION_LOCK_KEY = 8675309

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..', '..')
const MIGRATIONS_DIR = path.join(projectRoot, 'supabase', 'migrations')

/** Hosts that are unambiguously on this machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Derives the TLS settings from the connection string.
 *
 * Precedence:
 *   1. an explicit `sslmode` always wins — `require` means "encrypt, do not
 *      verify the chain" (`rejectUnauthorized: false`), `verify-full` means real
 *      verification, `disable` means plaintext;
 *   2. with no `sslmode`, a **remote** host still gets TLS. Supabase requires it,
 *      and talking to any managed database in plaintext is not acceptable. The
 *      certificate is not chain-verified because managed providers commonly
 *      terminate with a certificate a default trust store does not know;
 *   3. loopback is allowed to be unencrypted, which keeps local development
 *      against a bare Postgres simple.
 */
export function resolveSsl(connectionString) {
  let url
  try {
    url = new URL(connectionString)
  } catch {
    return { rejectUnauthorized: false }
  }

  const mode = (url.searchParams.get('sslmode') ?? '').toLowerCase()
  if (mode === 'disable') return false
  if (mode === 'verify-full' || mode === 'verify-ca') return { rejectUnauthorized: true }
  if (mode === 'require' || mode === 'prefer' || mode === 'no-verify') {
    return { rejectUnauthorized: false }
  }

  const host = url.hostname.toLowerCase()
  if (LOOPBACK_HOSTS.has(host)) return false
  return { rejectUnauthorized: false }
}

/**
 * Creates the production Postgres adapter.
 *
 * @param {{ connectionString: string, isProduction: boolean, max?: number, applicationName?: string }} options
 * @param {Console} [logger]
 */
export function createDb({ connectionString, isProduction, max = 5, applicationName = 'kudos' }, logger = console) {
  const pool = new Pool({
    connectionString,
    max,
    application_name: applicationName,
    ssl: resolveSsl(connectionString),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Serverless runtimes must not keep the process alive on an idle socket.
    allowExitOnIdle: true,
  })

  pool.on('error', (error) => {
    // A pooled connection dying between requests is not fatal; log without the
    // connection string, which contains the password.
    logger.error('[kudos] idle postgres client error', { message: error.message })
  })

  /**
   * @type {{
   *   kind: string,
   *   query: (text: string, params?: unknown[]) => Promise<{ rows: any[], rowCount: number }>,
   *   exec: (sql: string) => Promise<void>,
   *   transaction: <T>(fn: (client: any) => Promise<T>) => Promise<T>,
   *   withConnection: <T>(fn: (client: any) => Promise<T>) => Promise<T>,
   *   ping: () => Promise<void>,
   *   close: () => Promise<void>,
   * }}
   */
  const db = {
    kind: 'postgres',

    async query(text, params = []) {
      const result = await pool.query(text, params)
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length }
    },

    /** Runs SQL that may contain several statements and no parameters. */
    async exec(sql) {
      await pool.query(sql)
    },

    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(makeClient(client))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    /** Holds one dedicated connection for the duration of `fn`. */
    async withConnection(fn) {
      const client = await pool.connect()
      try {
        return await fn(makeClient(client))
      } finally {
        client.release()
      }
    },

    async ping() {
      await pool.query('SELECT 1')
    },

    async close() {
      await pool.end()
    },
  }

  return db
}

function makeClient(client) {
  return {
    async query(text, params = []) {
      const result = await client.query(text, params)
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length }
    },
    async exec(sql) {
      await client.query(sql)
    },
  }
}

/** @typedef {ReturnType<typeof createDb>} Db */

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

/**
 * Applies every migration in `supabase/migrations` that has not been applied yet.
 *
 * - Wrapped in a Postgres advisory lock, so several instances booting at once
 *   cannot race; the losers wait and then find the work already done.
 * - Each file runs in its own transaction, so a failure leaves no partial schema.
 * - Checksums are recorded, so an already-applied migration that was edited
 *   afterwards fails loudly instead of drifting silently.
 *
 * @param {Db} db
 * @param {{ dir?: string, logger?: Console }} [options]
 * @returns {Promise<{ applied: string[], skipped: number }>}
 */
export async function runMigrations(db, { dir = MIGRATIONS_DIR, logger = console } = {}) {
  const files = (await fsp.readdir(dir))
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  const applied = []

  await db.withConnection(async (client) => {
    await client.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text        PRIMARY KEY,
        checksum   text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    await client.exec(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`)
    try {
      const existing = new Map(
        (await client.query('SELECT version, checksum FROM schema_migrations')).rows.map((row) => [
          row.version,
          row.checksum,
        ]),
      )

      for (const file of files) {
        const sql = await fsp.readFile(path.join(dir, file), 'utf8')
        const checksum = sha256(sql)
        const previous = existing.get(file)

        if (previous === checksum) continue
        if (previous && previous !== checksum) {
          throw new Error(
            `Migration ${file} changed after it was applied. Add a new migration instead of editing it.`,
          )
        }

        await client.exec('BEGIN')
        try {
          await client.exec(sql)
          await client.query(
            'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
            [file, checksum],
          )
          await client.exec('COMMIT')
        } catch (error) {
          await client.exec('ROLLBACK').catch(() => undefined)
          throw new Error(`Migration ${file} failed: ${error.message}`)
        }

        applied.push(file)
        logger.log(`[kudos] applied migration ${file}`)
      }
    } finally {
      await client.exec(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`).catch(() => undefined)
    }
  })

  return { applied, skipped: files.length - applied.length }
}

/** Reads the applied migration versions. Used by tests and the migrate script. */
export async function listAppliedMigrations(db) {
  const { rows } = await db.query(
    `SELECT version, applied_at FROM schema_migrations ORDER BY version`,
  )
  return rows
}

/** Tables the running application requires. */
const REQUIRED_TABLES = [
  'schema_migrations',
  'users',
  'businesses',
  'testimonials',
  'sessions',
  'rate_limit_hits',
]

/**
 * Fails fast when the database has not been migrated.
 *
 * The application never applies migrations itself — that is an explicit
 * administrative step (`npm run migrate`). Applying them on boot would mean a
 * cold start could change the schema, and on serverless every instance would
 * race to do it. The trade-off is that forgetting to migrate becomes possible,
 * so boot verifies the schema instead of failing later with a confusing error.
 *
 * Deliberately filesystem free: a serverless bundle does not necessarily contain
 * `supabase/migrations`, so this checks the database itself.
 *
 * @param {any} db
 */
export async function assertSchemaReady(db) {
  const { rows } = await db.query(
    `SELECT array_agg(name) AS missing
       FROM unnest($1::text[]) AS name
      WHERE to_regclass('public.' || name) IS NULL`,
    [REQUIRED_TABLES],
  )

  const missing = rows[0]?.missing ?? null
  if (missing && missing.length > 0) {
    throw new Error(
      `Database schema is not up to date — missing: ${missing.join(', ')}. ` +
        'Run `npm run migrate` before starting the server.',
    )
  }
  return true
}

/**
 * Applies migrations over a short-lived connection of its own.
 *
 * Called only by `npm run migrate` and `npm run verify:deployment`; never by the
 * server. Migrations get a dedicated connection for two reasons:
 *   1. Supabase's transaction pooler (port 6543) may hand each statement to a
 *      different backend, and `pg_advisory_lock` is session scoped — the lock
 *      would not survive. `SUPABASE_MIGRATION_DB_URL` points at the session
 *      pooler (5432) where the lock behaves correctly.
 *   2. The lock must be held on one connection for the whole run, which a shared
 *      request pool cannot guarantee.
 *
 * When no separate migration URL is configured, the runtime URL is used.
 *
 * @param {{ databaseUrl: string, migrationDatabaseUrl?: string | null, isProduction: boolean }} config
 * @param {Console} [logger]
 */
export async function runMigrationsFromConfig(config, logger = console) {
  const connectionString = config.migrationDatabaseUrl || config.databaseUrl

  // The transaction pooler multiplexes statements across backends, so a
  // session-scoped advisory lock cannot be trusted there. Say so rather than
  // failing mysteriously under concurrent cold starts.
  if (!config.usesSeparateMigrationUrl && isTransactionPooler(connectionString)) {
    logger.warn(
      '[kudos] migrations are running over a transaction pooler (port 6543). ' +
        'Set SUPABASE_MIGRATION_DB_URL to the session pooler (port 5432) so the ' +
        'advisory lock is reliable.',
    )
  }

  const db = createDb(
    {
      connectionString,
      isProduction: config.isProduction,
      max: 1,
      applicationName: 'kudos-migrate',
    },
    logger,
  )

  try {
    await db.ping()
    return await runMigrations(db, { logger })
  } finally {
    await db.close()
  }
}

/** True for Supabase's transaction-mode pooler, which defaults to port 6543. */
export function isTransactionPooler(connectionString) {
  try {
    return new URL(connectionString).port === '6543'
  } catch {
    return false
  }
}
