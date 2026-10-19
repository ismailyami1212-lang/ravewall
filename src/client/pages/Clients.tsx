import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppBar } from '../components/AppBar'
import { Button, Card, EmptyState, Field, Input, Spinner } from '../components/Primitives'
import { useToast } from '../components/Toast'
import { useSession } from '../session'
import { workspaceApi, type Client, type ClientSummary, type Project } from '../api'

export function Clients() {
  const { notify } = useToast()
  const navigate = useNavigate()
  const { role } = useSession()

  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [summaries, setSummaries] = useState<Map<string, ClientSummary>>(new Map())
  const [counts, setCounts] = useState<{ clients: number; projects: number }>({ clients: 0, projects: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canManage = role === 'owner' || role === 'admin'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, proj, info, summary] = await Promise.all([
        workspaceApi.listClients(),
        workspaceApi.listProjects(),
        workspaceApi.info(),
        workspaceApi.clientsSummary(),
      ])
      setClients(list.items)
      setProjects(proj.items)
      setCounts(info.counts)
      setSummaries(new Map(summary.items.map((item) => [item.id, item])))
    } catch {
      notify('Could not load clients.', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  const projectsByClient = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of projects) map.set(p.clientId, (map.get(p.clientId) ?? 0) + 1)
    return map
  }, [projects])

  const visibleClients = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return clients
    return clients.filter((c) => `${c.name} ${c.slug}`.toLowerCase().includes(term))
  }, [clients, search])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await workspaceApi.createClient({ name: name.trim(), slug: slug.trim() || undefined })
      notify(`Created ${res.client.name}.`, 'success')
      setName('')
      setSlug('')
      setShowForm(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the client.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <AppBar />
      <main className="container">
        <div className="page-head page-head-row">
          <div>
            <h1>Clients</h1>
            <p>Every client you manage lives in this workspace. Add a client to start collecting their testimonials.</p>
          </div>
          <div className="row-actions">
            {clients.length > 0 ? (
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients"
                aria-label="Search clients"
                className="input-search"
              />
            ) : null}
            {canManage ? (
              <Button variant="primary" size="sm" onClick={() => setShowForm((v) => !v)}>
                {showForm ? 'Close' : 'Add client'}
              </Button>
            ) : null}
          </div>
        </div>

        {showForm && canManage ? (
          <Card className="card-pad" style={{ marginBottom: 24 }}>
            <form onSubmit={create} className="form-grid">
              <Field label="Client name" htmlFor="client-name" error={error || undefined}>
                <Input
                  id="client-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Co"
                  required
                />
              </Field>
              <Field
                label="Link name"
                htmlFor="client-slug"
                hint={slug ? `ravewall.com/t/${slug}` : 'Auto-generated from the name'}
                optional
              >
                <Input
                  id="client-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="acme-co"
                />
              </Field>
              <div className="form-actions">
                <Button type="submit" loading={busy}>
                  Create client
                </Button>
              </div>
            </form>
          </Card>
        ) : null}

        {loading ? (
          <div className="list-loading">
            <Spinner label="Loading clients" />
          </div>
        ) : clients.length === 0 ? (
          <EmptyState
            title="No clients yet"
            description="Add your first client to create a branded collection link and start gathering testimonials."
            action={
              canManage ? (
                <Button variant="primary" onClick={() => setShowForm(true)}>
                  Add your first client
                </Button>
              ) : (
                undefined
              )
            }
          />
        ) : visibleClients.length === 0 ? (
          <EmptyState
            title="No clients match"
            description="Try a different search term."
            action={
              <Button variant="ghost" onClick={() => setSearch('')}>
                Clear search
              </Button>
            }
          />
        ) : (
          <div className="client-grid">
            {visibleClients.map((client) => {
              const summary = summaries.get(client.id)
              const projectCount = summary?.projects ?? projectsByClient.get(client.id) ?? 0
              const testimonials = summary?.testimonials ?? 0
              return (
                <Link
                  key={client.id}
                  to={`/clients/${client.id}`}
                  className="client-card"
                  style={{ ['--accent' as string]: client.accentColor }}
                >
                  <span className="client-dot" style={{ background: client.accentColor }} aria-hidden="true" />
                  <div className="client-card-body">
                    <strong>{client.name}</strong>
                    <span className="muted">/{client.slug}</span>
                    <span className="client-meta">
                      {testimonials} testimonial{testimonials === 1 ? '' : 's'} · {projectCount} project
                      {projectCount === 1 ? '' : 's'}
                    </span>
                    {summary && summary.pending > 0 ? (
                      <span className="badge badge-pending client-attention">{summary.pending} pending</span>
                    ) : null}
                  </div>
                  <span className="client-arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
