import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  api,
  collectUrl,
  contentApi,
  copyText,
  testimonialToText,
  wallUrl,
  workspaceApi,
  type Client,
  type Project,
  type Stats,
  type Testimonial,
  type TestimonialStatus,
} from '../api'
import { AppBar } from '../components/AppBar'
import { Button, Card, EmptyState, Input, Spinner, StatCard, StatusBadge } from '../components/Primitives'
import { Stars } from '../components/Stars'
import { useToast } from '../components/Toast'
import { formatRelative, initials } from '../format'
import { useSession } from '../session'

type Filter = 'pending' | 'approved' | 'rejected' | 'all'
type Overview = Awaited<ReturnType<typeof contentApi.workspaceAnalytics>>

const ONBOARDING_KEY = 'ravewall.onboarding.dismissed'

const EMPTY_STATS: Stats = {
  total: 0,
  pending: 0,
  approved: 0,
  rejected: 0,
  averageRating: 0,
  lastSubmissionAt: null,
}

const TABS: { key: Filter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

export function Dashboard() {
  const { business } = useSession()
  const { notify } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)

  const [filter, setFilter] = useState<Filter>(() => {
    const status = searchParams.get('status')
    return status === 'approved' || status === 'rejected' || status === 'all' ? status : 'pending'
  })
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'rating'>('newest')
  const [items, setItems] = useState<Testimonial[]>([])
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  // Resolve the active client/project from the URL, falling back to the session's
  // primary client and that client's default project.
  const clientId = searchParams.get('clientId') ?? business?.id ?? ''
  const projectId = searchParams.get('projectId') ?? ''

  const activeClient = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  )
  const clientProjects = useMemo(
    () => projects.filter((p) => p.clientId === clientId),
    [projects, clientId],
  )
  const effectiveProjectId = projectId || activeClient ? (projectId || clientProjects.find((p) => p.isDefault)?.id || '') : ''
  const activeProject = clientProjects.find((p) => p.id === effectiveProjectId) ?? null

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  // Load the workspace's clients + projects for the picker.
  useEffect(() => {
    void (async () => {
      try {
        const [c, p] = await Promise.all([workspaceApi.listClients(), workspaceApi.listProjects()])
        setClients(c.items)
        setProjects(p.items)
      } catch {
        /* picker stays empty; inbox still works off the primary client */
      }
    })()
  }, [])

  // Workspace-wide aggregates power the agency overview + onboarding checklist.
  const refreshOverview = useCallback(async () => {
    try {
      setOverview(await contentApi.workspaceAnalytics())
    } catch {
      /* advisory only — the moderation inbox still works */
    }
  }, [])

  useEffect(() => {
    void refreshOverview()
  }, [refreshOverview])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.listTestimonials({
        status: filter,
        q: debouncedSearch,
        sort,
        clientId: clientId || undefined,
        projectId: effectiveProjectId || undefined,
      })
      setItems(result.items)
      setStats(result.stats)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load testimonials.')
    } finally {
      setLoading(false)
    }
  }, [filter, debouncedSearch, sort, clientId, effectiveProjectId])

  useEffect(() => {
    void load()
  }, [load])

  function pickClient(id: string) {
    const params = new URLSearchParams(searchParams)
    if (id) params.set('clientId', id)
    else params.delete('clientId')
    params.delete('projectId')
    setSearchParams(params, { replace: true })
  }

  function pickProject(id: string) {
    const params = new URLSearchParams(searchParams)
    if (id) params.set('projectId', id)
    else params.delete('projectId')
    setSearchParams(params, { replace: true })
  }

  async function moderate(testimonial: Testimonial, status: TestimonialStatus) {
    setBusyId(testimonial.id)
    try {
      const result = await api.moderate(testimonial.id, status, { clientId: clientId || undefined, projectId: effectiveProjectId || undefined })
      setStats(result.stats)
      setItems((current) =>
        filter === 'all'
          ? current.map((row) => (row.id === testimonial.id ? { ...row, status: result.testimonial.status } : row))
          : current.filter((row) => row.id !== testimonial.id),
      )
      notify(
        status === 'approved' ? 'Published to your wall.' : status === 'rejected' ? 'Moved to rejected.' : 'Moved back to pending.',
        'success',
      )
      void refreshOverview()
    } catch (moderationError) {
      notify(moderationError instanceof Error ? moderationError.message : 'Could not update that.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(testimonial: Testimonial) {
    setBusyId(testimonial.id)
    try {
      const result = await api.remove(testimonial.id, { clientId: clientId || undefined, projectId: effectiveProjectId || undefined })
      setStats(result.stats)
      setItems((current) => current.filter((row) => row.id !== testimonial.id))
      notify('Testimonial deleted.', 'success')
      void refreshOverview()
    } catch (removeError) {
      notify(removeError instanceof Error ? removeError.message : 'Could not delete that.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function copy(testimonial: Testimonial) {
    const ok = await copyText(testimonialToText(testimonial))
    notify(ok ? 'Testimonial copied to your clipboard.' : 'Could not access the clipboard.', ok ? 'success' : 'error')
  }

  const tabs = useMemo(
    () =>
      TABS.map((tab) => ({
        ...tab,
        count: tab.key === 'all' ? stats.total : (stats[tab.key as 'pending' | 'approved' | 'rejected'] ?? 0),
      })),
    [stats],
  )

  const scope = clientId || effectiveProjectId
  const shareSlug = activeClient?.slug ?? business?.slug ?? ''

  return (
    <div className="app-shell">
      <AppBar />
      <main className="container">
        <div className="page-head page-head-row">
          <div>
            <h1>{activeClient ? activeClient.name : business?.name}</h1>
            <p>
              {activeProject ? `Project: ${activeProject.name}` : 'Review what came in, publish the good ones, and share your links.'}
            </p>
          </div>
          <div className="row-actions">
            {shareSlug ? (
              <>
                <a className="btn btn-outline btn-sm" href={collectUrl(shareSlug)} target="_blank" rel="noreferrer">
                  Collect link
                </a>
                <a className="btn btn-ghost btn-sm" href={wallUrl(shareSlug)} target="_blank" rel="noreferrer">
                  View wall
                </a>
              </>
            ) : null}
          </div>
        </div>

        {overview ? <OnboardingChecklist overview={overview} /> : null}

        {overview && clients.length > 1 ? (
          <section className="card card-pad stack agency-overview">
            <div className="section-title-row">
              <h2 className="section-title">Agency overview</h2>
              <Link to="/analytics" className="btn btn-ghost btn-sm">
                Open analytics
              </Link>
            </div>
            <div className="overview-metrics">
              <div className="overview-metric">
                <span className="muted">Clients</span>
                <strong>{overview.clients}</strong>
              </div>
              <div className="overview-metric">
                <span className="muted">Testimonials</span>
                <strong>{overview.testimonials}</strong>
              </div>
              <div className="overview-metric">
                <span className="muted">Pending</span>
                <strong>{overview.pending}</strong>
              </div>
              <div className="overview-metric">
                <span className="muted">Live widgets</span>
                <strong>{overview.widgets.live}</strong>
              </div>
            </div>

            {overview.pending > 0 || overview.widgets.draft > 0 ? (
              <div className="attention-list">
                <p className="link-label">Needs your attention</p>
                {overview.pending > 0 ? (
                  <Link className="attention-item" to="/dashboard?status=pending">
                    <span>
                      <strong>{overview.pending}</strong> testimonial{overview.pending === 1 ? '' : 's'} awaiting
                      approval
                    </span>
                    <span aria-hidden="true">→</span>
                  </Link>
                ) : null}
                {overview.widgets.draft > 0 ? (
                  <Link className="attention-item" to="/widgets?status=draft">
                    <span>
                      <strong>{overview.widgets.draft}</strong> draft widget{overview.widgets.draft === 1 ? '' : 's'} not
                      yet published
                    </span>
                    <span aria-hidden="true">→</span>
                  </Link>
                ) : null}
              </div>
            ) : (
              <p className="muted">You are all caught up — nothing is waiting for review.</p>
            )}

            {overview.topClients.length > 0 ? (
              <div>
                <p className="link-label">Clients</p>
                <ul className="overview-clients">
                  {overview.topClients.map((client) => (
                    <li key={client.id}>
                      <Link to={`/clients/${client.id}`}>
                        <span className="dot" style={{ background: client.accentColor }} aria-hidden="true" />
                        <span className="overview-client-name">{client.name}</span>
                        <span className="muted">
                          {client.approved} published{client.pending > 0 ? ` · ${client.pending} pending` : ''}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {(clients.length > 1 || clientProjects.length > 1) && clientId ? (
          <div className="scope-picker">
            <label>
              <span className="muted">Client</span>
              <select className="input input-select" value={clientId} onChange={(e) => pickClient(e.target.value)} aria-label="Select client">
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {clientProjects.length > 0 ? (
              <label>
                <span className="muted">Project</span>
                <select className="input input-select" value={effectiveProjectId} onChange={(e) => pickProject(e.target.value)} aria-label="Select project">
                  {clientProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {activeClient ? <Link to={`/clients/${activeClient.id}`} className="btn btn-ghost btn-sm">Client settings</Link> : null}
          </div>
        ) : null}

        <section className="stats-grid">
          <StatCard label="Total" value={stats.total} hint={formatRelative(stats.lastSubmissionAt)} />
          <StatCard label="Pending" value={stats.pending} hint="Waiting for review" accent />
          <StatCard label="Published" value={stats.approved} hint="Visible on your wall" />
          <StatCard
            label="Average rating"
            value={stats.approved > 0 ? stats.averageRating.toFixed(1) : '—'}
            hint={stats.approved > 0 ? `from ${stats.approved} published` : 'No published reviews yet'}
          />
        </section>

        <section className="card">
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Filter testimonials">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  role="tab"
                  type="button"
                  aria-selected={filter === tab.key}
                  className={`tab ${filter === tab.key ? 'tab-on' : ''}`.trim()}
                  onClick={() => setFilter(tab.key)}
                >
                  {tab.label}
                  <span className="tab-count">{tab.count}</span>
                </button>
              ))}
            </div>
            <div className="toolbar-right">
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, company or text"
                aria-label="Search testimonials"
                className="input-search"
              />
              <select
                className="input input-select"
                value={sort}
                onChange={(event) => setSort(event.target.value as typeof sort)}
                aria-label="Sort testimonials"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="rating">Highest rated</option>
              </select>
            </div>
          </div>

          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
              <Button variant="ghost" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : null}

          {loading ? (
            <div className="list-loading">
              <Spinner label="Loading testimonials" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title={
                filter === 'pending'
                  ? 'Nothing waiting for review'
                  : filter === 'approved'
                    ? 'No published testimonials yet'
                    : filter === 'rejected'
                      ? 'Nothing rejected'
                      : debouncedSearch
                        ? 'No matches'
                        : 'No testimonials yet'
              }
              description={
                !scope && stats.total === 0
                  ? 'Choose a client above, then share your collection link and submissions will appear here.'
                  : debouncedSearch
                    ? 'Try a different search term.'
                    : undefined
              }
            />
          ) : (
            <ul className="review-list">
              {items.map((testimonial) => (
                <TestimonialRow
                  key={testimonial.id}
                  testimonial={testimonial}
                  busy={busyId === testimonial.id}
                  onModerate={moderate}
                  onDelete={remove}
                  onCopy={copy}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

function TestimonialRow({
  testimonial,
  busy,
  onModerate,
  onDelete,
  onCopy,
}: {
  testimonial: Testimonial
  busy: boolean
  onModerate: (testimonial: Testimonial, status: TestimonialStatus) => void
  onDelete: (testimonial: Testimonial) => void
  onCopy: (testimonial: Testimonial) => void
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="review" data-status={testimonial.status}>
      <div className="review-main">
        <div className="review-head">
          <span className="avatar avatar-sm" aria-hidden="true">
            {initials(testimonial.name)}
          </span>
          <div className="review-identity">
            <strong>{testimonial.name}</strong>
            {testimonial.company ? <span className="muted">{testimonial.company}</span> : null}
          </div>
          <Stars value={testimonial.rating} size="sm" />
          <StatusBadge status={testimonial.status} />
          <span className="muted review-date">{formatRelative(testimonial.createdAt)}</span>
        </div>
        <p className="review-text">{testimonial.text}</p>
      </div>

      <div className="review-actions">
        {testimonial.status !== 'approved' ? (
          <Button size="sm" loading={busy} onClick={() => onModerate(testimonial, 'approved')} aria-label={`Approve testimonial from ${testimonial.name}`}>
            Approve
          </Button>
        ) : null}
        {testimonial.status !== 'rejected' ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onModerate(testimonial, 'rejected')} aria-label={`Reject testimonial from ${testimonial.name}`}>
            Reject
          </Button>
        ) : null}
        {testimonial.status !== 'pending' ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onModerate(testimonial, 'pending')} aria-label={`Move testimonial from ${testimonial.name} back to pending`}>
            Restore
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onCopy(testimonial)} aria-label={`Copy testimonial from ${testimonial.name}`}>
          Copy
        </Button>
        {confirming ? (
          <span className="confirm-inline">
            <Button size="sm" variant="danger" loading={busy} onClick={() => onDelete(testimonial)}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" className="btn-danger-text" disabled={busy} onClick={() => setConfirming(true)} aria-label={`Delete testimonial from ${testimonial.name}`}>
            Delete
          </Button>
        )}
      </div>
    </li>
  )
}

/**
 * Progressive, dismissible activation checklist. Every step is derived from
 * real workspace data, so it can never claim progress the account has not made.
 */
function OnboardingChecklist({ overview }: { overview: Overview }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === '1'
    } catch {
      return false
    }
  })
  if (dismissed) return null

  const steps = [
    { label: 'Add a client', done: overview.clients >= 1, to: '/clients' },
    { label: 'Collect a testimonial', done: overview.testimonials >= 1, to: '/clients' },
    { label: 'Approve a testimonial', done: overview.approved >= 1, to: '/dashboard' },
    { label: 'Create a widget', done: overview.widgets.total >= 1, to: '/widgets' },
    { label: 'Publish a widget', done: overview.widgets.live >= 1, to: '/widgets?status=draft' },
  ]
  const doneCount = steps.filter((step) => step.done).length
  if (doneCount === steps.length) return null

  function dismiss() {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1')
    } catch {
      /* private mode — the dismissal lasts for this session */
    }
    setDismissed(true)
  }

  return (
    <section className="card card-pad onboarding">
      <div className="section-title-row">
        <h2 className="section-title">Get started</h2>
        <div className="row-actions">
          <span className="muted">
            {doneCount} of {steps.length}
          </span>
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      </div>
      <ul className="onboarding-steps">
        {steps.map((step) => (
          <li key={step.label} className={`onboarding-step ${step.done ? 'onboarding-step-done' : ''}`.trim()}>
            <span className="onboarding-check" aria-hidden="true">
              {step.done ? '✓' : '○'}
            </span>
            {step.done ? <span>{step.label}</span> : <Link to={step.to}>{step.label}</Link>}
          </li>
        ))}
      </ul>
    </section>
  )
}
