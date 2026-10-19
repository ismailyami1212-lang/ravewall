import { describe, expect, it } from 'vitest'
import { describeConfig, loadConfig } from '../server/config.js'

const VALID = {
  NODE_ENV: 'production',
  SUPABASE_DB_URL: 'postgresql://user:secret@db.example.com:6543/postgres?sslmode=require',
  SESSION_SECRET: 'a'.repeat(48),
}

describe('loadConfig', () => {
  it('accepts a valid production environment', () => {
    const config = loadConfig(VALID)
    expect(config.isProduction).toBe(true)
    expect(config.databaseUrl).toBe(VALID.SUPABASE_DB_URL)
    expect(config.port).toBe(3001)
    expect(config.poolMax).toBe(5)
    expect(config.sessionTtlDays).toBe(30)
  })

  it('fails closed when the database URL is missing', () => {
    expect(() => loadConfig({ ...VALID, SUPABASE_DB_URL: undefined })).toThrow(
      /SUPABASE_DB_URL is required/,
    )
  })

  it('fails closed when the session secret is missing or too short', () => {
    expect(() => loadConfig({ ...VALID, SESSION_SECRET: undefined })).toThrow(
      /SESSION_SECRET is required/,
    )
    expect(() => loadConfig({ ...VALID, SESSION_SECRET: 'short' })).toThrow(
      /at least 32 characters/,
    )
  })

  it('rejects a connection string that is not postgres', () => {
    expect(() => loadConfig({ ...VALID, SUPABASE_DB_URL: 'mysql://x/y' })).toThrow(
      /must be a postgres/,
    )
  })

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...VALID, NODE_ENV: 'staging' })).toThrow(/NODE_ENV must be/)
  })

  it('reports every problem at once', () => {
    const error = (() => {
      try {
        loadConfig({ NODE_ENV: 'production' })
        return null
      } catch (thrown) {
        return thrown
      }
    })()
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/SUPABASE_DB_URL/)
    expect(error.message).toMatch(/SESSION_SECRET/)
  })

  it('never falls back to a local data directory', () => {
    const config = loadConfig(VALID)
    expect(config).not.toHaveProperty('dataDir')
    expect(config).not.toHaveProperty('dataFile')
  })

  it('reads numeric overrides and ignores junk', () => {
    const config = loadConfig({
      ...VALID,
      PORT: '8080',
      PG_POOL_MAX: '2',
      SUBMISSION_DAILY_QUOTA: '25',
      RATE_LIMIT_AUTH_MAX: '3',
      RATE_LIMIT_SUBMIT_WINDOW_MS: '1000',
    })
    expect(config.port).toBe(8080)
    expect(config.poolMax).toBe(2)
    expect(config.submissionDailyQuota).toBe(25)
    expect(config.rateLimits.auth.max).toBe(3)
    expect(config.rateLimits.submit.windowMs).toBe(1000)

    // Empty and nonsense values fall back to the defaults rather than 0/NaN.
    const fallback = loadConfig({ ...VALID, PORT: '', PG_POOL_MAX: 'abc' })
    expect(fallback.port).toBe(3001)
    expect(fallback.poolMax).toBe(5)
  })

  it('parses the origin allow-list', () => {
    const config = loadConfig({
      ...VALID,
      ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com/',
    })
    expect(config.allowedOrigins).toEqual(['https://a.example.com', 'https://b.example.com'])
  })
})

describe('describeConfig', () => {
  it('redacts secrets so they can be logged safely', () => {
    const described = describeConfig(VALID)
    expect(described.SUPABASE_DB_URL).toBe('[redacted]')
    expect(described.SESSION_SECRET).toBe('[redacted]')
    expect(JSON.stringify(described)).not.toContain('secret@db.example.com')
    expect(JSON.stringify(described)).not.toContain('a'.repeat(48))
  })
})
