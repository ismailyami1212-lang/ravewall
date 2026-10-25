/**
 * RaveWall activation funnel — derived, read-only reporting.
 *
 * The report is computed from rows that already exist (workspaces, clients,
 * projects, testimonials and saved widgets); no analytics table, event stream
 * or write is involved. That keeps the report honest about the current state
 * of the data and safe to run against production at any time.
 *
 * Milestones (all scoped to workspaces created inside the window):
 *   1. Workspace created.
 *   2. Workspace has at least one client (`businesses.workspace_id`).
 *   3. Workspace has at least one testimonial on any of its projects.
 *   4. Workspace has at least one *approved* testimonial.
 *   5. Workspace has at least one *live* saved widget. Draft and archived
 *      widgets are deliberately ignored.
 *
 * Every milestone is a DISTINCT set of workspace ids, so a workspace with
 * several clients or testimonials is counted exactly once per milestone.
 *
 * The module exports `computeFunnel`/`runReport` so the SQL can be exercised
 * against a real PostgreSQL (PGlite in tests) by passing in a database client.
 * The Postgres connection is imported lazily, which means importing this file
 * never opens a socket or requires production configuration.
 */
import { pathToFileURL } from 'node:url'

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Converts a count into a percentage with one decimal place.
 *
 * A zero (or missing) denominator yields 0, never `NaN`/`Infinity`, so an empty
 * cohort renders as `0.0%` instead of crashing the report.
 *
 * @param {number} part
 * @param {number} whole
 * @returns {number}
 */
export function conversionRate(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

/**
 * Computes the five activation milestones for workspaces created in the last
 * `days` days.
 *
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db
 * @param {number} days window length in days (7 and 30 are used by `runReport`)
 * @param {{ now?: Date }} [options] injectable clock, so tests are deterministic
 */
export async function computeFunnel(db, days, { now = new Date() } = {}) {
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`days must be a positive number (received ${days})`)
  }
  if (!db || typeof db.query !== 'function') {
    throw new Error('computeFunnel requires a database client with a query() method')
  }

  const to = new Date(now)
  const from = new Date(to.getTime() - days * DAY_MS)

  // Each CTE returns a DISTINCT set of workspace ids from the cohort. A client
  // with many projects, or a project with many testimonials/widgets, therefore
  // cannot multiply the count for that workspace.
  const sql = `
    WITH cohort AS (
      SELECT w.id
        FROM workspaces w
       WHERE w.created_at >= $1
         AND w.created_at <= $2
    ),
    has_client AS (
      SELECT DISTINCT co.id AS workspace_id
        FROM cohort co
        JOIN businesses b ON b.workspace_id = co.id
    ),
    has_testimonial AS (
      SELECT DISTINCT co.id AS workspace_id
        FROM cohort co
        JOIN businesses b ON b.workspace_id = co.id
        JOIN projects p   ON p.business_id = b.id
        JOIN testimonials t ON t.project_id = p.id
    ),
    has_approved AS (
      SELECT DISTINCT co.id AS workspace_id
        FROM cohort co
        JOIN businesses b ON b.workspace_id = co.id
        JOIN projects p   ON p.business_id = b.id
        JOIN testimonials t ON t.project_id = p.id
       WHERE t.status = 'approved'
    ),
    has_live_widget AS (
      SELECT DISTINCT co.id AS workspace_id
        FROM cohort co
        JOIN businesses b ON b.workspace_id = co.id
        JOIN projects p   ON p.business_id = b.id
        JOIN widget_configs wc ON wc.project_id = p.id
       WHERE wc.status = 'live'
    )
    SELECT
      (SELECT COUNT(*) FROM cohort)          AS new_workspaces,
      (SELECT COUNT(*) FROM has_client)      AS with_client,
      (SELECT COUNT(*) FROM has_testimonial) AS with_testimonial,
      (SELECT COUNT(*) FROM has_approved)    AS with_approved,
      (SELECT COUNT(*) FROM has_live_widget) AS with_live_widget
  `

  const { rows } = await db.query(sql, [from.toISOString(), to.toISOString()])
  const row = rows[0] ?? {}

  const newWorkspaces = Number(row.new_workspaces ?? 0)
  const withClient = Number(row.with_client ?? 0)
  const withTestimonial = Number(row.with_testimonial ?? 0)
  const withApprovedTestimonial = Number(row.with_approved ?? 0)
  const withLiveWidget = Number(row.with_live_widget ?? 0)

  return {
    range: { from: from.toISOString(), to: to.toISOString(), days },
    totals: {
      newWorkspaces,
      withClient,
      withTestimonial,
      withApprovedTestimonial,
      withLiveWidget,
    },
    conversion: {
      workspaceToClient: conversionRate(withClient, newWorkspaces),
      clientToTestimonial: conversionRate(withTestimonial, withClient),
      testimonialToApproval: conversionRate(withApprovedTestimonial, withTestimonial),
      approvalToLiveWidget: conversionRate(withLiveWidget, withApprovedTestimonial),
      overallActivation: conversionRate(withLiveWidget, newWorkspaces),
    },
  }
}

/** Computes both the 7-day and 30-day windows. */
export async function runReport(db, { now = new Date() } = {}) {
  const d7 = await computeFunnel(db, 7, { now })
  const d30 = await computeFunnel(db, 30, { now })
  return { d7, d30 }
}

/** Formats a rate with exactly one decimal place (`0.0%`, `66.7%`). */
export function formatRate(value) {
  return `${Number(value).toFixed(1)}%`
}

/**
 * Renders one window as aggregate text. Kept separate from `computeFunnel` so
 * tests can verify the empty cohort renders as `0.0%` and never as `NaN`.
 *
 * @param {{ range: { days: number, from: string, to: string }, totals: any, conversion: any }} funnel
 */
export function formatFunnel(funnel) {
  const { range, totals, conversion } = funnel
  return [
    `Window: last ${range.days} days (${range.from} → ${range.to})`,
    `  Workspaces created   : ${totals.newWorkspaces}`,
    `  With >=1 client      : ${totals.withClient} (${formatRate(conversion.workspaceToClient)} of new workspaces)`,
    `  With >=1 testimonial : ${totals.withTestimonial} (${formatRate(conversion.clientToTestimonial)} of workspaces with a client)`,
    `  With >=1 approved    : ${totals.withApprovedTestimonial} (${formatRate(conversion.testimonialToApproval)} of workspaces with a testimonial)`,
    `  With >=1 live widget : ${totals.withLiveWidget} (${formatRate(conversion.approvalToLiveWidget)} of workspaces with an approved testimonial)`,
    `  Overall activation   : ${formatRate(conversion.overallActivation)} (live widget / new workspaces)`,
  ].join('\n')
}

/** Renders the full 7-day + 30-day report. */
export function formatReport(report) {
  return [
    '=== RaveWall Activation Funnel (derived, read-only) ===',
    '',
    'Last 7 days',
    formatFunnel(report.d7),
    '',
    'Last 30 days',
    formatFunnel(report.d30),
    '',
    'Note: the live-widget milestone counts workspaces that currently have at',
    'least one widget with status="live". Draft and archived widgets do not',
    'count, and historical first-publish timestamps are not tracked.',
  ].join('\n')
}

async function main() {
  // Imported lazily: tests (and any other importer) can use the pure functions
  // above without a Postgres driver or production environment variables.
  const [{ loadConfig }, { createDb }] = await Promise.all([
    import('../src/server/config.js'),
    import('../src/server/db.js'),
  ])

  const config = loadConfig()
  const db = createDb(
    {
      connectionString: config.databaseUrl,
      isProduction: config.isProduction,
      max: 1,
      applicationName: 'ravewall-activation-report',
    },
    console,
  )

  try {
    const report = await runReport(db)
    console.log(formatReport(report))
  } finally {
    await db.close()
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`activation report failed: ${error.message}`)
    process.exit(1)
  })
}
