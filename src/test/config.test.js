import { describe, expect, it } from 'vitest'
import { describeConfig, loadConfig } from '../server/config.js'

const VALID = {
  NODE_ENV: 'production',
  SUPABASE_DB_URL: 'postgresql://user:secret@db.example.com:6543/postgres?sslmode=require',
  SESSION_SECRET: 'a'.repeat(48),
  APP_URL: 'https://ravewall.example.com',
}

const STRIPE = {
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
  STRIPE_PRICE_STARTER: 'price_starter',
  STRIPE_PRICE_PRO: 'price_pro',
  STRIPE_PRICE_AGENCY: 'price_agency',
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

  it('fails closed in production when APP_URL is missing or not an origin', () => {
    expect(() => loadConfig({ ...VALID, APP_URL: undefined })).toThrow(/APP_URL is required/)
    expect(() => loadConfig({ ...VALID, APP_URL: '  ' })).toThrow(/APP_URL is required/)
    expect(() => loadConfig({ ...VALID, APP_URL: 'https://ravewall.example.com/app' })).toThrow(
      /APP_URL must be an absolute http\(s\) origin/,
    )
  })

  it('does not require APP_URL outside production', () => {
    const config = loadConfig({ ...VALID, NODE_ENV: 'test', APP_URL: undefined })
    expect(config.appUrl).toBeNull()
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

  it('keeps billing disabled when no Stripe variables are supplied', () => {
    const config = loadConfig(VALID)
    expect(config.billingEnabled).toBe(false)
    expect(config.stripeSecretKey).toBeNull()
    expect(config.stripePrices).toEqual({ starter: null, pro: null, agency: null })
  })

  it('accepts a complete Stripe configuration', () => {
    const config = loadConfig({ ...VALID, ...STRIPE })
    expect(config.billingEnabled).toBe(true)
    expect(config.stripeSecretKey).toBe('sk_test_123')
    expect(config.stripeWebhookSecret).toBe('whsec_test_123')
    expect(config.stripePrices).toEqual({
      starter: 'price_starter',
      pro: 'price_pro',
      agency: 'price_agency',
    })
  })

  it('fails closed when Stripe configuration is partial', () => {
    expect(() => loadConfig({ ...VALID, ...STRIPE, STRIPE_PRICE_PRO: undefined })).toThrow(
      /STRIPE_PRICE_PRO is required when Stripe billing is configured/,
    )
    expect(() => loadConfig({ ...VALID, STRIPE_WEBHOOK_SECRET: 'whsec_test_123' })).toThrow(
      /STRIPE_SECRET_KEY is required/,
    )
  })

  it('rejects Stripe ids that do not have the expected shape', () => {
    expect(() => loadConfig({ ...VALID, ...STRIPE, STRIPE_PRICE_PRO: 'prod_123' })).toThrow(
      /STRIPE_PRICE_PRO must be a Stripe price id/,
    )
    expect(() => loadConfig({ ...VALID, ...STRIPE, STRIPE_WEBHOOK_SECRET: 'secret' })).toThrow(
      /STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret/,
    )
  })
})

describe('describeConfig', () => {
  it('redacts secrets so they can be logged safely', () => {
    const described = describeConfig({ ...VALID, ...STRIPE })
    expect(described.SUPABASE_DB_URL).toBe('[redacted]')
    expect(described.SESSION_SECRET).toBe('[redacted]')
    expect(described.STRIPE_SECRET_KEY).toBe('[redacted]')
    expect(described.STRIPE_WEBHOOK_SECRET).toBe('[redacted]')
    expect(JSON.stringify(described)).not.toContain('secret@db.example.com')
    expect(JSON.stringify(described)).not.toContain('a'.repeat(48))
    expect(JSON.stringify(described)).not.toContain('sk_test_123')
    expect(JSON.stringify(described)).not.toContain('whsec_test_123')
  })
})
