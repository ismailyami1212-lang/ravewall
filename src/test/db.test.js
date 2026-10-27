import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertSchemaReady, listAppliedMigrations, isTransactionPooler, resolveSsl, runMigrations, runMigrationsFromConfig } from '../server/db.js'
import { createTestDb, tempDir } from './helpers/server.js'

const silent = { log() {}, error() {}, warn() {} }

let cleanupTasks = []

afterEach(async () => {
  for (const task of cleanupTasks) await task().catch(() => undefined)
  cleanupTasks = []
})

async function freshDb() {
  const db = await createTestDb()
  cleanupTasks.push(() => db.close())
  return db
}

async function tableNames(db) {
  const { rows } = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  )
  return rows.map((row) => row.tablename)
}

describe('migrations', () => {
  it('creates the full schema on a fresh database', async () => {
    const db = await freshDb()
    const { applied } = await runMigrations(db, { logger: silent })

    expect(applied).toEqual([
      '0001_initial.sql',
      '0002_rate_limiting.sql',
      '0003_brand_accent_default.sql',
      '0004_password_resets.sql',
      '0005_workspaces_projects.sql',
      '0006_saved_widgets.sql',
      '0007_stripe_billing.sql',
    ])
    expect(await tableNames(db)).toEqual([
      'businesses',
      'custom_questions',
      'password_resets',
      'projects',
      'rate_limit_hits',
      'schema_migrations',
      'sessions',
      'tags',
      'testimonial_tags',
      'testimonials',
      'users',
      'widget_configs',
      'workspace_member_clients',
      'workspace_members',
      'workspaces',
    ])
  })

  it('is idempotent', async () => {
    const db = await freshDb()
    await runMigrations(db, { logger: silent })
    const second = await runMigrations(db, { logger: silent })

    expect(second.applied).toEqual([])
    expect(second.skipped).toBe(7)
    expect(await listAppliedMigrations(db)).toHaveLength(7)
  })

  it('records each version with a checksum', async () => {
    const db = await freshDb()
    await runMigrations(db, { logger: silent })

    const { rows } = await db.query('SELECT version, checksum FROM schema_migrations ORDER BY version')
    expect(rows.map((row) => row.version)).toEqual([
      '0001_initial.sql',
      '0002_rate_limiting.sql',
      '0003_brand_accent_default.sql',
      '0004_password_resets.sql',
      '0005_workspaces_projects.sql',
      '0006_saved_widgets.sql',
      '0007_stripe_billing.sql',
    ])
    for (const row of rows) expect(row.checksum).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses to run when an applied migration was edited afterwards', async () => {
    const { dir, cleanup } = await tempDir()
    cleanupTasks.push(cleanup)
    await fsp.writeFile(path.join(dir, '0001_one.sql'), 'CREATE TABLE alpha (id int)')

    const db = await freshDb()
    await runMigrations(db, { dir, logger: silent })

    // Someone edits a migration that has already shipped.
    await fsp.writeFile(path.join(dir, '0001_one.sql'), 'CREATE TABLE alpha (id bigint)')
    await expect(runMigrations(db, { dir, logger: silent })).rejects.toThrow(/changed after it was applied/)
  })

  it('rolls back a failing migration instead of leaving a partial schema', async () => {
    const { dir, cleanup } = await tempDir()
    cleanupTasks.push(cleanup)
    await fsp.writeFile(path.join(dir, '0001_ok.sql'), 'CREATE TABLE alpha (id int)')
    await fsp.writeFile(
      path.join(dir, '0002_broken.sql'),
      'CREATE TABLE beta (id int);\nTHIS IS NOT VALID SQL;',
    )

    const db = await freshDb()
    await expect(runMigrations(db, { dir, logger: silent })).rejects.toThrow(/0002_broken\.sql/)

    const tables = await tableNames(db)
    expect(tables).toContain('alpha')
    // The second migration was rolled back, so nothing it created survives.
    expect(tables).not.toContain('beta')
    const applied = await listAppliedMigrations(db)
    expect(applied.map((row) => row.version)).toEqual(['0001_ok.sql'])
  })

  it('applies new migrations on top of an existing schema', async () => {
    const { dir, cleanup } = await tempDir()
    cleanupTasks.push(cleanup)
    await fsp.writeFile(path.join(dir, '0001_one.sql'), 'CREATE TABLE alpha (id int)')

    const db = await freshDb()
    await runMigrations(db, { dir, logger: silent })

    await fsp.writeFile(path.join(dir, '0002_two.sql'), 'CREATE TABLE beta (id int)')
    const result = await runMigrations(db, { dir, logger: silent })

    expect(result.applied).toEqual(['0002_two.sql'])
    expect(await tableNames(db)).toContain('beta')
  })
})

describe('schema constraints', () => {
  async function seededDb() {
    const db = await freshDb()
    await runMigrations(db, { logger: silent })
    const { rows } = await db.query(
      `INSERT INTO users (email, name, password_hash, password_salt)
       VALUES ('owner@example.com', 'Owner', 'hash', 'salt') RETURNING id`,
    )
    const userId = rows[0].id
    const ws = await db.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING id', ['Northwind'])
    const workspaceId = ws.rows[0].id
    await db.query(
      "INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')",
      [workspaceId, userId],
    )
    const business = await db.query(
      `INSERT INTO businesses (workspace_id, owner_user_id, name, slug) VALUES ($1, $2, 'Northwind', 'northwind') RETURNING id`,
      [workspaceId, userId],
    )
    const businessId = business.rows[0].id
    const project = await db.query(
      `INSERT INTO projects (workspace_id, business_id, name, slug, is_default) VALUES ($1, $2, 'Main', 'main', true) RETURNING id`,
      [workspaceId, businessId],
    )
    return { db, userId, workspaceId, businessId, projectId: project.rows[0].id }
  }

  it('rejects a rating outside 1-5', async () => {
    const { db, businessId, projectId } = await seededDb()
    for (const rating of [0, 6, -1]) {
      await expect(
        db.query(
          `INSERT INTO testimonials (business_id, project_id, author_name, rating, content)
           VALUES ($1, $3, 'A', $2, 'A perfectly reasonable testimonial body.')`,
          [businessId, rating, projectId],
        ),
      ).rejects.toMatchObject({ code: '23514' })
    }
  })

  it('rejects an unknown status', async () => {
    const { db, businessId, projectId } = await seededDb()
    await expect(
      db.query(
        `INSERT INTO testimonials (business_id, project_id, author_name, rating, content, status)
         VALUES ($1, $2, 'A', 5, 'A perfectly reasonable testimonial body.', 'published')`,
        [businessId, projectId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects a malformed slug, a bad colour and an unsafe logo URL', async () => {
    const { db, userId, workspaceId } = await seededDb()
    const insert = (slug, accent, logo) =>
      db.query(
        `INSERT INTO businesses (workspace_id, owner_user_id, name, slug, accent_color, logo_url)
         VALUES ($1, $2, 'X', $3, $4, $5)`,
        [workspaceId, userId, slug, accent, logo],
      )

    await expect(insert('Bad Slug', '#15803d', '')).rejects.toMatchObject({ code: '23514' })
    await expect(insert('ok-slug', 'red', '')).rejects.toMatchObject({ code: '23514' })
    await expect(insert('ok-slug-2', '#15803d', 'javascript:alert(1)')).rejects.toMatchObject({
      code: '23514',
    })
  })

  it('rejects a duplicate slug (the old single-business-per-account limit is gone)', async () => {
    const { db, userId, workspaceId } = await seededDb()
    await expect(
      db.query(
        `INSERT INTO businesses (workspace_id, owner_user_id, name, slug) VALUES ($1, $2, 'X', 'northwind')`,
        [workspaceId, userId],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('enforces a lowercase unique email', async () => {
    const { db } = await seededDb()
    await expect(
      db.query(
        `INSERT INTO users (email, name, password_hash, password_salt)
         VALUES ('OWNER@example.com', 'X', 'h', 's')`,
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await expect(
      db.query(
        `INSERT INTO users (email, name, password_hash, password_salt)
         VALUES ('owner@example.com', 'X', 'h', 's')`,
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('cascades deletes from users to businesses and testimonials', async () => {
    const { db, userId, businessId, projectId } = await seededDb()
    await db.query(
      `INSERT INTO testimonials (business_id, project_id, author_name, rating, content)
       VALUES ($1, $2, 'A', 5, 'A perfectly reasonable testimonial body.')`,
      [businessId, projectId],
    )
    await db.query('DELETE FROM users WHERE id = $1', [userId])

    expect((await db.query('SELECT 1 FROM businesses')).rows).toHaveLength(0)
    expect((await db.query('SELECT 1 FROM testimonials')).rows).toHaveLength(0)
  })

  it('keeps updated_at current through the trigger', async () => {
    const { db, businessId } = await seededDb()
    const before = await db.query('SELECT updated_at FROM businesses WHERE id = $1', [businessId])
    await new Promise((resolve) => setTimeout(resolve, 5))
    const after = await db.query(
      `UPDATE businesses SET name = 'Renamed' WHERE id = $1 RETURNING updated_at`,
      [businessId],
    )
    expect(after.rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(
      before.rows[0].updated_at.getTime(),
    )
  })

  it('has RLS enabled on every application table', async () => {
    const db = await freshDb()
    await runMigrations(db, { logger: silent })
    const { rows } = await db.query(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('users','businesses','testimonials','sessions','rate_limit_hits','workspaces','workspace_members','projects','custom_questions','tags','testimonial_tags','widget_configs')`,
    )
    expect(rows).toHaveLength(12)
    for (const row of rows) expect(row.relrowsecurity).toBe(true)
  })
})

describe('resolveSsl', () => {
  it('honours an explicit sslmode', () => {
    expect(resolveSsl('postgresql://u:p@h.example.com:5432/db?sslmode=require')).toEqual({
      rejectUnauthorized: false,
    })
    expect(resolveSsl('postgresql://u:p@h.example.com:5432/db?sslmode=verify-full')).toEqual({
      rejectUnauthorized: true,
    })
    expect(resolveSsl('postgresql://u:p@h.example.com:5432/db?sslmode=disable')).toBe(false)
  })

  it('encrypts a remote host even when sslmode is absent', () => {
    // Supabase requires TLS, and its connection strings do not always carry an
    // explicit sslmode. Talking to a managed database in plaintext is not an
    // option, so remote hosts default to TLS.
    expect(resolveSsl('postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres')).toEqual({
      rejectUnauthorized: false,
    })
    expect(resolveSsl('postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres')).toEqual({
      rejectUnauthorized: false,
    })
  })

  it('leaves loopback unencrypted so local development stays simple', () => {
    expect(resolveSsl('postgresql://u:p@127.0.0.1:5432/db')).toBe(false)
    expect(resolveSsl('postgresql://u:p@localhost:5432/db')).toBe(false)
  })

  it('defaults to encryption when the URL cannot be parsed', () => {
    expect(resolveSsl('not-a-url')).toEqual({ rejectUnauthorized: false })
  })
})

describe('assertSchemaReady', () => {
  it('passes on a migrated database', async () => {
    const db = await freshDb()
    await runMigrations(db, { logger: silent })
    await expect(assertSchemaReady(db)).resolves.toBe(true)
  })

  it('fails closed on an unmigrated database, naming what is missing', async () => {
    const db = await freshDb()
    // No migrations applied at all.
    const error = await assertSchemaReady(db).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/not up to date/i)
    expect(error.message).toMatch(/npm run migrate/)
    expect(error.message).toMatch(/testimonials/)
  })

  it('detects a partially migrated schema', async () => {
    const db = await freshDb()
    await runMigrations(db, { logger: silent })
    await db.exec('DROP TABLE testimonials CASCADE')

    const error = await assertSchemaReady(db).catch((thrown) => thrown)
    expect(error.message).toMatch(/testimonials/)
    // Only the missing table is named.
    expect(error.message).not.toMatch(/businesses/)
  })
})

describe('isTransactionPooler', () => {
  it('recognises Supabase’s transaction pooler port', () => {
    expect(isTransactionPooler('postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres')).toBe(
      true,
    )
    expect(isTransactionPooler('postgresql://u:p@aws-0-eu.pooler.supabase.com:5432/postgres')).toBe(
      false,
    )
    expect(isTransactionPooler('postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres')).toBe(
      false,
    )
    expect(isTransactionPooler('not-a-url')).toBe(false)
  })
})

describe('runMigrationsFromConfig', () => {
  // Closed ports on loopback: connection refused, immediately, with no credentials
  // ever leaving the process.
  const transactionPooler = 'postgresql://nobody:sekret@127.0.0.1:6543/nothing'
  const sessionPooler = 'postgresql://nobody:sekret@127.0.0.1:5432/nothing'

  function captureLogger() {
    const warnings = []
    const errors = []
    return {
      warnings,
      errors,
      logger: {
        log() {},
        warn: (message) => warnings.push(String(message)),
        error: (message) => errors.push(String(message)),
      },
    }
  }

  it('warns when migrations would run over the transaction pooler', async () => {
    const capture = captureLogger()

    await expect(
      runMigrationsFromConfig(
        {
          databaseUrl: transactionPooler,
          migrationDatabaseUrl: transactionPooler,
          isProduction: false,
          usesSeparateMigrationUrl: false,
        },
        capture.logger,
      ),
    ).rejects.toThrow()

    // The advisory lock is session scoped, so this combination is a real hazard.
    expect(capture.warnings.join(' ')).toMatch(/transaction pooler/i)
    expect(capture.warnings.join(' ')).toMatch(/SUPABASE_MIGRATION_DB_URL/)
  })

  it('stays quiet when a separate session connection is configured', async () => {
    const capture = captureLogger()

    await expect(
      runMigrationsFromConfig(
        {
          databaseUrl: transactionPooler,
          migrationDatabaseUrl: sessionPooler,
          isProduction: false,
          usesSeparateMigrationUrl: true,
        },
        capture.logger,
      ),
    ).rejects.toThrow()

    expect(capture.warnings).toEqual([])
  })

  it('fails closed on an unreachable database without echoing credentials', async () => {
    const capture = captureLogger()

    const error = await runMigrationsFromConfig(
      {
        databaseUrl: sessionPooler,
        migrationDatabaseUrl: sessionPooler,
        isProduction: true,
        usesSeparateMigrationUrl: false,
      },
      capture.logger,
    ).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).not.toContain('sekret')
    expect(JSON.stringify(capture.warnings) + JSON.stringify(capture.errors)).not.toContain('sekret')
  })
})
