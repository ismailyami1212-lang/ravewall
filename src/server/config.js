/**
 * Environment configuration.
 *
 * Validated once at startup and then frozen into a plain object. Startup fails
 * loudly when a required value is missing — there is no fallback storage and no
 * generated default, because a production process that boots with the wrong
 * database is worse than one that refuses to boot.
 *
 * `loadConfig` is a function rather than a module-level constant so tests can
 * supply their own environment without touching the real one.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Absolute path of the project root (…/testimonial-wall). */
export const projectRoot = path.resolve(here, '..', '..')

/** Where local secrets live. Gitignored, never committed, never logged. */
export const envFilePath = path.join(projectRoot, '.env')

/**
 * Resolves which env file to read.
 *
 * `ENV_FILE` overrides the default. Tests use it to point at a path that does
 * not exist, so a suite run can never pick up — or worse, write to — the
 * developer's real configuration.
 */
export function resolveEnvFilePath(env = process.env) {
  const override = env.ENV_FILE
  if (override !== undefined && String(override).trim() !== '') return String(override).trim()
  return envFilePath
}

const GENERATE_SECRET = 'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'

/**
 * Minimal `.env` reader.
 *
 * Deliberately dependency free and deliberately simple: `KEY=VALUE` lines,
 * `#` comments, optional surrounding quotes, an optional `export ` prefix. No
 * expansion, no multiline values.
 *
 * A variable that is already set to a non-empty value in the real environment
 * always wins, so a platform's configuration is never overridden by a stray
 * file that happened to be deployed.
 *
 * @param {{ filePath?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {{ loaded: boolean, path: string, keys: string[] }}
 */
export function loadEnvFile({ filePath = envFilePath, env = process.env } = {}) {
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return { loaded: false, path: filePath, keys: [] }
  }

  const keys = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    let key = trimmed.slice(0, separator).trim()
    if (key.startsWith('export ')) key = key.slice('export '.length).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    let value = trimmed.slice(separator + 1).trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted && value.length >= 2) value = value.slice(1, -1)

    const existing = env[key]
    if (existing !== undefined && existing !== '') continue

    env[key] = value
    keys.push(key)
  }

  return { loaded: true, path: filePath, keys }
}

function readNumber(value, fallback) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function readInteger(value, fallback) {
  const parsed = readNumber(value, fallback)
  return Number.isInteger(parsed) ? parsed : Math.floor(parsed)
}

function readBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase())
}

function readList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

const DB_URL_HINT =
  'Copy the connection string from your Supabase project ' +
  '(Project Settings → Database → Connection string → URI).'

/** A required Postgres connection string, reported with exactly one problem. */
const postgresUrl = (name, hint) =>
  z
    .string({ required_error: `${name} is required. ${hint}` })
    .trim()
    .min(1, `${name} is required. ${hint}`)
    .refine(
      // An empty value has already been reported by `min`, so skip it here
      // rather than emitting two messages for the same field.
      (value) => value === '' || /^postgres(ql)?:\/\//i.test(value),
      `${name} must be a postgres:// or postgresql:// connection string.`,
    )

/** An optional Postgres connection string. An empty value means "not set". */
const optionalPostgresUrl = (name) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()))
    .refine(
      (value) => value === undefined || /^postgres(ql)?:\/\//i.test(value),
      `${name} must be a postgres:// or postgresql:// connection string.`,
    )

/** The only variables that must be present for the process to boot. */
const requiredSchema = z.object({
  SUPABASE_DB_URL: postgresUrl('SUPABASE_DB_URL', DB_URL_HINT),
  SESSION_SECRET: z
    .string({
      required_error: `SESSION_SECRET is required. Generate one with: ${GENERATE_SECRET}`,
    })
    .min(
      32,
      `SESSION_SECRET must be at least 32 characters. Generate one with: ${GENERATE_SECRET}`,
    ),
})

/** Optional: a separate connection for migrations (see buildConfig). */
const optionalSchema = z.object({
  SUPABASE_MIGRATION_DB_URL: optionalPostgresUrl('SUPABASE_MIGRATION_DB_URL'),
})

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  // When reading the real environment, honour a local .env file first. An
  // explicit object (tests, scripts) never touches the filesystem.
  if (env === process.env) loadEnvFile({ filePath: resolveEnvFilePath(env), env })

  const required = requiredSchema.safeParse(env)
  const optional = optionalSchema.safeParse(env)

  const issues = [
    ...(required.success ? [] : required.error.issues),
    ...(optional.success ? [] : optional.error.issues),
  ]
  if (issues.length > 0) {
    const details = issues
      .map((issue) => `  - ${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('\n')
    throw new Error(
      `Invalid environment configuration.\n${details}\n\n` +
        `Fill in ${resolveEnvFilePath(env)} (see .env.example for the full list).`,
    )
  }

  const nodeEnv = env.NODE_ENV || 'development'
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be development, test or production (received "${nodeEnv}").`)
  }

  return buildConfig({ ...env, NODE_ENV: nodeEnv, ...required.data, ...optional.data })
}

function buildConfig(env) {
  const isProduction = env.NODE_ENV === 'production'

  // Supabase hands out two connection strings and they are not interchangeable
  // for migrations: `pg_advisory_lock` is session scoped, and the transaction
  // pooler (port 6543) may hand each statement to a different backend, so the
  // lock would not hold. Migrations therefore use the session pooler (5432)
  // when it is configured.
  const migrationDatabaseUrl = env.SUPABASE_MIGRATION_DB_URL || env.SUPABASE_DB_URL

  return Object.freeze({
    projectRoot,
    nodeEnv: env.NODE_ENV,
    isProduction,
    isTest: env.NODE_ENV === 'test',

    host: env.HOST || '0.0.0.0',
    port: readInteger(env.PORT, 3001),
    /** Public origin of the deployment; used for absolute links in emails/logs. */
    appUrl: env.APP_URL ? String(env.APP_URL).replace(/\/$/, '') : null,

    /** Postgres connection string used to serve requests. Never exposed to the client. */
    databaseUrl: env.SUPABASE_DB_URL,
    /**
     * Connection used only by `npm run migrate` and `npm run verify:deployment`.
     * The running server never reads it, so it does not need to be present in a
     * deployed runtime environment. Falls back to `databaseUrl`.
     */
    migrationDatabaseUrl,
    usesSeparateMigrationUrl: migrationDatabaseUrl !== env.SUPABASE_DB_URL,
    poolMax: readInteger(env.PG_POOL_MAX, isProduction ? 5 : 10),

    sessionSecret: env.SESSION_SECRET,
    sessionTtlDays: readNumber(env.SESSION_TTL_DAYS, 30),

    /** Password-reset token lifetime, in minutes (default 1 hour). */
    resetTokenTtlMinutes: readNumber(env.RESET_TOKEN_TTL_MINUTES, 60),
    /**
     * Transactional email (Resend). Optional: without a key the service runs
     * normally and reset emails go to the development transport (logged).
     */
    resendApiKey: env.RESEND_API_KEY?.trim() || null,
    /**
     * Sender address. Defaults to Resend's shared TEST sender, which can only
     * deliver to the Resend account owner's own address — never to arbitrary
     * customers. Set EMAIL_FROM to an address on a verified domain to go live.
     */
    emailFrom: env.EMAIL_FROM?.trim() || 'RaveWall <onboarding@resend.dev>',
    /**
     * Optional safety valve for the test sender: when set, the email layer
     * only delivers to this address and skips every other recipient. Keeps a
     * test key from sending anything to a real customer.
     */
    emailTestRecipient: env.EMAIL_TEST_RECIPIENT?.trim().toLowerCase() || null,

    trustProxy: readBoolean(env.TRUST_PROXY, true),
    allowedOrigins: readList(env.ALLOWED_ORIGINS),

    staticDir: path.join(projectRoot, 'dist'),

    rateLimits: {
      auth: {
        windowMs: readInteger(env.RATE_LIMIT_AUTH_WINDOW_MS, 5 * 60 * 1000),
        max: readInteger(env.RATE_LIMIT_AUTH_MAX, 10),
      },
      submit: {
        windowMs: readInteger(env.RATE_LIMIT_SUBMIT_WINDOW_MS, 10 * 60 * 1000),
        max: readInteger(env.RATE_LIMIT_SUBMIT_MAX, 8),
      },
      api: {
        windowMs: readInteger(env.RATE_LIMIT_API_WINDOW_MS, 5 * 60 * 1000),
        max: readInteger(env.RATE_LIMIT_API_MAX, 600),
      },
    },
    submissionDailyQuota: readInteger(env.SUBMISSION_DAILY_QUOTA, 200),
  })
}

/**
 * Redacts anything that must never reach a log line.
 * @param {Record<string, string | undefined>} env
 */
export function describeConfig(env) {
  const safe = { ...env }
  for (const key of ['SUPABASE_DB_URL', 'SUPABASE_MIGRATION_DB_URL', 'SESSION_SECRET', 'RESEND_API_KEY']) {
    if (safe[key]) safe[key] = '[redacted]'
  }
  return safe
}
