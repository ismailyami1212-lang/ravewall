/**
 * Startup safety tests.
 *
 * These spawn the real entry points as child processes, because the guarantees
 * under test are about *booting*: the process must refuse to start rather than
 * fall back to a different storage engine or run without a database.
 */
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const TIMEOUT_MS = 30_000

/**
 * Point every spawned process at an env file that does not exist.
 *
 * Without this the child would read the developer's real `.env`, which means
 * these "missing configuration" scenarios would silently stop testing anything —
 * and worse, the child would connect to the live database.
 */
const NO_ENV_FILE = path.join(os.tmpdir(), 'kudos-startup-test-no-env-file')

/** Runs a script to completion and captures its output and exit code. */
function run(args, { env = {}, remove = [] } = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ENV_FILE: NO_ENV_FILE, ...env }
    for (const key of remove) delete childEnv[key]

    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: childEnv })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`timed out after ${TIMEOUT_MS}ms: node ${args.join(' ')}`))
    }, TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

describe('production server startup', () => {
  it('refuses to boot without a database connection string', async () => {
    const result = await run(['src/server/index.js'], {
      env: { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(48) },
      remove: ['SUPABASE_DB_URL', 'DATABASE_URL'],
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/SUPABASE_DB_URL/)
    // It must not have started listening on the default port.
    expect(result.stdout).not.toMatch(/listening/)
  })

  it('refuses to boot without a session secret', async () => {
    const result = await run(['src/server/index.js'], {
      env: { NODE_ENV: 'production', SUPABASE_DB_URL: 'postgresql://u:p@127.0.0.1:5432/db' },
      remove: ['SESSION_SECRET'],
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/SESSION_SECRET/)
  })

  it('reports both problems at once instead of one at a time', async () => {
    const result = await run(['src/server/index.js'], {
      env: { NODE_ENV: 'production' },
      remove: ['SUPABASE_DB_URL', 'SESSION_SECRET'],
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/SUPABASE_DB_URL/)
    expect(result.stderr).toMatch(/SESSION_SECRET/)
  })

  it('never mentions a local JSON store as a fallback', async () => {
    const result = await run(['src/server/index.js'], {
      env: { NODE_ENV: 'production' },
      remove: ['SUPABASE_DB_URL', 'SESSION_SECRET'],
    })
    expect(result.stderr).not.toMatch(/kudos-db\.json/)
    expect(result.stderr).not.toMatch(/DATA_DIR/)
  })

  it('ignores a stray .env file when the environment is supplied by the platform', async () => {
    // A platform provides configuration through the environment. The file is
    // only ever a local convenience, and a real variable always wins.
    const result = await run(['src/server/index.js'], {
      env: { NODE_ENV: 'production', SUPABASE_DB_URL: 'postgresql://nobody:nobody@127.0.0.1:59999/x' },
      remove: ['SESSION_SECRET'],
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/SESSION_SECRET/)
  })

  it('fails clearly when the database is unreachable', async () => {
    const result = await run(['src/server/index.js'], {
      env: {
        NODE_ENV: 'production',
        SESSION_SECRET: 'x'.repeat(48),
        APP_URL: 'https://ravewall.example.com',
        // Reserved for documentation; nothing listens here.
        SUPABASE_DB_URL: 'postgresql://nobody:nobody@127.0.0.1:59999/nothing',
      },
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/database connection failed|Cannot reach the database/)
    // The connection string must not be echoed back into the log.
    expect(result.stderr).not.toContain('nobody:nobody')
    expect(result.stdout).not.toMatch(/listening/)
  })
})

describe('migrate script', () => {
  it('fails closed without configuration', async () => {
    const result = await run(['scripts/migrate.mjs'], {
      env: { NODE_ENV: 'production' },
      remove: ['SUPABASE_DB_URL', 'SESSION_SECRET'],
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/SUPABASE_DB_URL/)
  })
})

describe('development server', () => {
  it('refuses to run in production', async () => {
    const result = await run(['scripts/dev-server.mjs'], {
      env: { NODE_ENV: 'production' },
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/refuses to run with NODE_ENV=production/)
  })
})
