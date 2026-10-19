/**
 * `.env` loading.
 *
 * The README tells an operator to fill in `.env`, so something has to read it.
 * These tests pin the parser's rules and, critically, the precedence rule: a real
 * environment variable always beats the file, so a platform's configuration is
 * never overridden by a stray file.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { envFilePath, loadConfig, loadEnvFile, projectRoot, resolveEnvFilePath } from '../server/config.js'
import { tempDir } from './helpers/server.js'

let dir
let file
let cleanups = []

beforeEach(async () => {
  const created = await tempDir()
  dir = created.dir
  cleanups.push(created.cleanup)
  file = path.join(dir, '.env')
})

afterEach(async () => {
  for (const cleanup of cleanups) await cleanup().catch(() => undefined)
  cleanups = []
})

describe('loadEnvFile', () => {
  it('points at the project root by default', () => {
    expect(envFilePath).toBe(path.join(projectRoot, '.env'))
  })

  it('reports a missing file without throwing', () => {
    const result = loadEnvFile({ filePath: path.join(dir, 'absent.env'), env: {} })
    expect(result.loaded).toBe(false)
    expect(result.keys).toEqual([])
  })

  it('parses keys, ignores comments and blank lines, strips quotes', async () => {
    await fsp.writeFile(
      file,
      [
        '# a comment',
        '',
        'SUPABASE_DB_URL=postgresql://u:p@h:6543/postgres',
        '  SESSION_SECRET = "quoted value"  ',
        "SINGLE='single quoted'",
        'export EXPORTED=yes',
        'NO_EQUALS_SIGN',
        '1INVALID=value',
        'EMPTY=',
      ].join('\n'),
    )

    const env = {}
    const result = loadEnvFile({ filePath: file, env })

    expect(result.loaded).toBe(true)
    expect(env.SUPABASE_DB_URL).toBe('postgresql://u:p@h:6543/postgres')
    expect(env.SESSION_SECRET).toBe('quoted value')
    expect(env.SINGLE).toBe('single quoted')
    expect(env.EXPORTED).toBe('yes')
    expect(env.EMPTY).toBe('')
    // Malformed lines are skipped rather than guessed at.
    expect(env).not.toHaveProperty('NO_EQUALS_SIGN')
    expect(env).not.toHaveProperty('1INVALID')
  })

  it('handles CRLF line endings', async () => {
    await fsp.writeFile(file, 'A=1\r\nB=2\r\n')
    const env = {}
    loadEnvFile({ filePath: file, env })
    expect(env).toEqual({ A: '1', B: '2' })
  })

  it('never overrides a real environment variable', async () => {
    await fsp.writeFile(file, 'SESSION_SECRET=from-file\nOTHER=from-file\n')
    const env = { SESSION_SECRET: 'from-the-real-environment' }

    loadEnvFile({ filePath: file, env })

    expect(env.SESSION_SECRET).toBe('from-the-real-environment')
    expect(env.OTHER).toBe('from-file')
  })

  it('treats a real empty value as unset so a placeholder cannot shadow the file', async () => {
    await fsp.writeFile(file, 'SESSION_SECRET=from-file\n')
    const env = { SESSION_SECRET: '' }
    loadEnvFile({ filePath: file, env })
    expect(env.SESSION_SECRET).toBe('from-file')
  })

  it('does not expand variables or run code', async () => {
    await fsp.writeFile(file, 'A=$HOME\nB=`whoami`\n')
    const env = {}
    loadEnvFile({ filePath: file, env })
    expect(env.A).toBe('$HOME')
    expect(env.B).toBe('`whoami`')
  })
})

describe('resolveEnvFilePath', () => {
  it('defaults to the project .env', () => {
    expect(resolveEnvFilePath({})).toBe(envFilePath)
    expect(envFilePath).toBe(path.join(projectRoot, '.env'))
  })

  it('honours an explicit ENV_FILE', () => {
    // This is what keeps spawned-process tests away from the developer's real
    // configuration — and away from the live database it points at.
    expect(resolveEnvFilePath({ ENV_FILE: path.join(dir, 'other.env') })).toBe(
      path.join(dir, 'other.env'),
    )
  })

  it('treats a blank ENV_FILE as unset', () => {
    expect(resolveEnvFilePath({ ENV_FILE: '' })).toBe(envFilePath)
    expect(resolveEnvFilePath({ ENV_FILE: '   ' })).toBe(envFilePath)
  })
})

describe('loadConfig', () => {
  it('reads the real environment, with the file supplying only what is missing', () => {
    const saved = { ...process.env }
    try {
      process.env.SUPABASE_DB_URL = 'postgresql://probe:probe@127.0.0.1:6543/postgres'
      process.env.SESSION_SECRET = 'y'.repeat(48)

      const config = loadConfig()

      // The real values won, so the empty placeholders in .env did not matter.
      expect(config.databaseUrl).toBe(process.env.SUPABASE_DB_URL)
      expect(config.sessionSecret).toBe(process.env.SESSION_SECRET)
      expect(config.isProduction).toBe(false)
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in saved)) delete process.env[key]
      }
      Object.assign(process.env, saved)
    }
  })

  it('never touches the filesystem when given an explicit environment', () => {
    // This is what keeps the test suite independent of whatever is in .env.
    const config = loadConfig({
      NODE_ENV: 'test',
      SUPABASE_DB_URL: 'postgresql://u:p@127.0.0.1:5432/db',
      SESSION_SECRET: 'z'.repeat(48),
    })
    expect(config.nodeEnv).toBe('test')
    expect(config.migrationDatabaseUrl).toBe('postgresql://u:p@127.0.0.1:5432/db')
    expect(config.usesSeparateMigrationUrl).toBe(false)
  })
})

describe('migration connection', () => {
  const base = {
    NODE_ENV: 'production',
    SUPABASE_DB_URL: 'postgresql://u:p@aws-0-eu.pooler.supabase.com:6543/postgres',
    SESSION_SECRET: 's'.repeat(48),
  }

  it('falls back to the runtime URL when no migration URL is set', () => {
    const config = loadConfig(base)
    expect(config.migrationDatabaseUrl).toBe(base.SUPABASE_DB_URL)
    expect(config.usesSeparateMigrationUrl).toBe(false)
  })

  it('uses the session pooler for migrations when configured', () => {
    const config = loadConfig({
      ...base,
      SUPABASE_MIGRATION_DB_URL: 'postgresql://u:p@aws-0-eu.pooler.supabase.com:5432/postgres',
    })
    expect(new URL(config.databaseUrl).port).toBe('6543')
    expect(new URL(config.migrationDatabaseUrl).port).toBe('5432')
    expect(config.usesSeparateMigrationUrl).toBe(true)
  })

  it('treats an empty migration URL as not configured', () => {
    const config = loadConfig({ ...base, SUPABASE_MIGRATION_DB_URL: '' })
    expect(config.usesSeparateMigrationUrl).toBe(false)
    expect(config.migrationDatabaseUrl).toBe(base.SUPABASE_DB_URL)
  })

  it('rejects a migration URL that is not postgres', () => {
    expect(() => loadConfig({ ...base, SUPABASE_MIGRATION_DB_URL: 'mysql://x/y' })).toThrow(
      /SUPABASE_MIGRATION_DB_URL must be a postgres/,
    )
  })

  it('reports one problem per field, not two', () => {
    const error = (() => {
      try {
        loadConfig({ NODE_ENV: 'production' })
        return null
      } catch (thrown) {
        return thrown
      }
    })()
    const dbUrlLines = error.message.split('\n').filter((line) => line.includes('SUPABASE_DB_URL'))
    expect(dbUrlLines).toHaveLength(1)
  })

  it('redacts the migration URL too', async () => {
    const { describeConfig } = await import('../server/config.js')
    const described = describeConfig({
      SUPABASE_DB_URL: 'postgresql://u:p@h:6543/postgres',
      SUPABASE_MIGRATION_DB_URL: 'postgresql://u:p@h:5432/postgres',
      SESSION_SECRET: 's'.repeat(48),
    })
    expect(described.SUPABASE_DB_URL).toBe('[redacted]')
    expect(described.SUPABASE_MIGRATION_DB_URL).toBe('[redacted]')
    expect(JSON.stringify(described)).not.toContain('postgresql://')
  })
})
