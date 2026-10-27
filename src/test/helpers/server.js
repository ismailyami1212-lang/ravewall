import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { createApp } from '../../server/app.js'
import { loadConfig } from '../../server/config.js'
import { runMigrations } from '../../server/db.js'
import { createPgliteDb } from '../../../scripts/lib/pglite-db.mjs'

const silentLogger = { error() {}, warn() {}, log() {}, info() {} }

/** Environment a test run would use if it talked to a real Postgres. */
export const TEST_ENV = {
  NODE_ENV: 'test',
  SUPABASE_DB_URL: 'postgresql://kudos:kudos@127.0.0.1:5432/kudos_test',
  SESSION_SECRET: 'test-session-secret-that-is-long-enough-to-pass',
  APP_URL: 'https://ravewall.test',
}

/**
 * An in-process PostgreSQL (PGlite = real Postgres compiled to WASM).
 *
 * Tests therefore run the *actual* migrations and the *actual* SQL against real
 * Postgres semantics — constraints, `ON CONFLICT`, `FILTER`, plpgsql functions —
 * with no external service and no credentials.
 */
export async function createTestDb() {
  return createPgliteDb()
}

/**
 * One PostgreSQL instance per test file.
 *
 * Booting PGlite and running the migrations costs a couple of seconds, so the
 * instance is created once and each test starts from truncated tables instead.
 * Vitest gives every test file its own worker, so files never share a database.
 */
let shared = null

async function sharedDb() {
  if (!shared) {
    const db = await createTestDb()
    await runMigrations(db, { logger: silentLogger })
    shared = db
  }
  return shared
}

const TRUNCATE_ALL =
  'TRUNCATE TABLE users, workspaces, workspace_members, workspace_member_clients, businesses, projects, testimonials, sessions, rate_limit_hits, custom_questions, tags, testimonial_tags, widget_configs CASCADE'

/**
 * Boots the real Express app against a migrated Postgres with empty tables.
 *
 * @param {Record<string, unknown>} [overrides] config overrides for this app
 * @param {{ stripe?: any }} [options] dependency overrides (used by billing tests)
 */
export async function createTestServer(overrides = {}, options = {}) {
  const db = await sharedDb()
  // Rate limit counters are wiped along with the data, so a test that installs a
  // small ceiling starts from zero — exactly like a freshly booted instance.
  await db.exec(TRUNCATE_ALL)

  const config = {
    ...loadConfig(TEST_ENV),
    isProduction: false,
    trustProxy: false,
    ...overrides,
  }

  const app = createApp({ db, config, logger: silentLogger, stripe: options.stripe ?? null })

  return {
    app,
    db,
    config,
    /** Ad-hoc SQL for assertions that inspect persisted state. */
    sql: async (text, params = []) => (await db.query(text, params)).rows,
    /** The shared instance outlives each test; nothing to tear down here. */
    cleanup: async () => undefined,
  }
}

/** A temporary directory that is removed after the test. */
export async function tempDir() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kudos-test-'))
  return { dir, cleanup: () => fsp.rm(dir, { recursive: true, force: true }) }
}

export const VALID_PASSWORD = 'Passw0rd!'

/** Signs a user up and creates their business, returning the cookie agent. */
export async function seedAccount(request, app, { email, name = 'Owner', slug, businessName }) {
  const agent = request.agent(app)
  await agent.post('/api/auth/signup').send({ email, password: VALID_PASSWORD, name }).expect(201)
  await agent
    .post('/api/business')
    .send({ name: businessName ?? `${slug} Inc`, slug, accentColor: '#15803d' })
    .expect(201)
  return agent
}

export async function submitTestimonial(app, slug, overrides = {}) {
  return request(app)
    .post(`/api/public/submit/${slug}`)
    .send({
      rating: 5,
      name: 'Tobias Lang',
      company: 'Fieldnote',
      text: 'The onboarding was quick and the results were immediate.',
      ...overrides,
    })
}
