import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppBar } from '../components/AppBar'
import { Button, Card, EmptyState, Field, Input, Spinner, Textarea } from '../components/Primitives'
import { useToast } from '../components/Toast'
import { useSession } from '../session'
import { collectUrl, wallUrl, copyText, widgetEmbedSnippet, workspaceApi, contentApi, type Client, type Project, type ProjectSummary, type Question, type WidgetConfig } from '../api'

const ACCENTS = ['#15803d', '#0ea5e9', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#ca8a04', '#dc2626']
const TABS = ['Overview', 'Questions', 'Widgets', 'Analytics'] as const
type Tab = (typeof TABS)[number]

export function ClientDetail() {
  const { id = '' } = useParams()
  const { notify } = useToast()
  const navigate = useNavigate()
  const { role } = useSession()

  const [client, setClient] = useState<Client | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectSummaries, setProjectSummaries] = useState<Map<string, ProjectSummary>>(new Map())
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('Overview')
  const [activeProjectId, setActiveProjectId] = useState<string>('')

  const canManage = role === 'owner' || role === 'admin'
  const canModerate = canManage || role === 'manager'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, summary] = await Promise.all([workspaceApi.getClient(id), workspaceApi.projectsSummary()])
      setClient(res.client)
      setProjects(res.projects)
      setProjectSummaries(new Map(summary.items.map((item) => [item.id, item])))
      setActiveProjectId((prev) => prev || res.projects.find((p) => p.isDefault)?.id || res.projects[0]?.id || '')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not load this client.', 'error')
    } finally {
      setLoading(false)
    }
  }, [id, notify])

  useEffect(() => {
    void load()
  }, [load])

  const activeProject = useMemo(() => projects.find((p) => p.id === activeProjectId) ?? null, [projects, activeProjectId])

  if (loading) {
    return (
      <div className="app-shell">
        <AppBar />
        <main className="container">
          <div className="list-loading">
            <Spinner label="Loading client" />
          </div>
        </main>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="app-shell">
        <AppBar />
        <main className="container">
          <EmptyState title="Client not found" description="It may have been deleted, or you do not have access to it." action={<Link to="/clients" className="btn btn-primary btn-sm">Back to clients</Link>} />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <AppBar />
      <main className="container">
        <div className="page-head page-head-row">
          <div>
            <div className="crumb">
              <Link to="/clients">Clients</Link>
              <span aria-hidden="true">/</span>
              <span>{client.name}</span>
            </div>
            <h1>
              <span className="client-dot" style={{ background: client.accentColor }} aria-hidden="true" /> {client.name}
            </h1>
            <p>
              <code>/{client.slug}</code> · {projects.length} project{projects.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="row-actions">
            <a className="btn btn-outline btn-sm" href={collectUrl(client.slug)} target="_blank" rel="noreferrer">
              Collect link
            </a>
            <a className="btn btn-ghost btn-sm" href={wallUrl(client.slug)} target="_blank" rel="noreferrer">
              Public wall
            </a>
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Client sections">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              className={`tab ${tab === t ? 'tab-on' : ''}`.trim()}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'Overview' ? (
          <OverviewTab
            client={client}
            projects={projects}
            projectSummaries={projectSummaries}
            canManage={canManage}
            canModerate={canModerate}
            onSaved={load}
            onProjectCreated={load}
            activeProjectId={activeProjectId}
            setActiveProjectId={setActiveProjectId}
          />
        ) : null}
        {tab === 'Questions' && activeProject ? (
          <QuestionsTab project={activeProject} canModerate={canModerate} />
        ) : null}
        {tab === 'Widgets' && activeProject ? (
          <WidgetsTab project={activeProject} client={client} canModerate={canModerate} />
        ) : null}
        {tab === 'Analytics' && activeProject ? (
          <AnalyticsTab project={activeProject} />
        ) : null}
        {tab !== 'Overview' && !activeProject ? (
          <EmptyState title="Select a project" description="Choose a project above to manage its questions, widgets and analytics." />
        ) : null}
      </main>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function OverviewTab({
  client,
  projects,
  projectSummaries,
  canManage,
  canModerate,
  onSaved,
  onProjectCreated,
  activeProjectId,
  setActiveProjectId,
}: {
  client: Client
  projects: Project[]
  projectSummaries: Map<string, ProjectSummary>
  canManage: boolean
  canModerate: boolean
  onSaved: () => void
  onProjectCreated: () => void
  activeProjectId: string
  setActiveProjectId: (id: string) => void
}) {
  const { notify } = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: client.name, tagline: client.tagline, logoUrl: client.logoUrl, accentColor: client.accentColor })
  const [busy, setBusy] = useState(false)
  const [newProject, setNewProject] = useState('')
  const [projectBusy, setProjectBusy] = useState(false)

  async function saveBranding(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await workspaceApi.updateClient(client.id, form)
      notify('Branding saved.', 'success')
      onSaved()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save branding.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function addProject(e: React.FormEvent) {
    e.preventDefault()
    if (!newProject.trim()) return
    setProjectBusy(true)
    try {
      await workspaceApi.createProject(client.id, { name: newProject.trim() })
      notify('Project created.', 'success')
      setNewProject('')
      onProjectCreated()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not create project.', 'error')
    } finally {
      setProjectBusy(false)
    }
  }

  return (
    <div className="detail-grid">
      <Card className="card-pad">
        <h3 className="section-title">Branding</h3>
        <form onSubmit={saveBranding} className="form-grid">
          <Field label="Client name" htmlFor="b-name">
            <Input id="b-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required disabled={!canManage} />
          </Field>
          <Field label="Tagline" htmlFor="b-tag" optional>
            <Input id="b-tag" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} disabled={!canManage} />
          </Field>
          <Field label="Logo URL" htmlFor="b-logo" optional>
            <Input id="b-logo" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…" disabled={!canManage} />
          </Field>
          <Field label="Accent colour" htmlFor="b-accent">
            <div className="swatch-row">
              {ACCENTS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`swatch ${form.accentColor === c ? 'swatch-on' : ''}`.trim()}
                  style={{ background: c }}
                  aria-label={`Use ${c}`}
                  onClick={() => canManage && setForm({ ...form, accentColor: c })}
                />
              ))}
              <input
                type="color"
                value={form.accentColor}
                onChange={(e) => canManage && setForm({ ...form, accentColor: e.target.value })}
                aria-label="Custom accent colour"
                disabled={!canManage}
              />
            </div>
          </Field>
          {canManage ? (
            <div className="form-actions">
              <Button type="submit" loading={busy}>
                Save branding
              </Button>
            </div>
          ) : null}
        </form>
      </Card>

      <Card className="card-pad">
        <h3 className="section-title">Projects</h3>
        <p className="muted">Collection efforts inside this client. Pick one to manage questions, widgets and analytics.</p>
        <ul className="project-list">
          {projects.map((p) => {
            const summary = projectSummaries.get(p.id)
            return (
              <li key={p.id} className={`project-row ${p.id === activeProjectId ? 'project-row-on' : ''}`.trim()}>
                <button type="button" className="project-select" onClick={() => setActiveProjectId(p.id)}>
                  <strong>{p.name}</strong>
                  {p.isDefault ? <span className="badge badge-approved">default</span> : null}
                  <span className="muted">/{p.slug}</span>
                  <span className="muted project-meta">
                    {summary?.testimonials ?? 0} testimonial{(summary?.testimonials ?? 0) === 1 ? '' : 's'} ·{' '}
                    {summary?.widgets ?? 0} widget{(summary?.widgets ?? 0) === 1 ? '' : 's'}
                    {summary && summary.pending > 0 ? ` · ${summary.pending} pending` : ''}
                  </span>
                </button>
                {canModerate ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigate(`/dashboard?clientId=${client.id}&projectId=${p.id}`)}
                  >
                    Moderate
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
        {canModerate ? (
          <form onSubmit={addProject} className="inline-form">
            <Input value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder="New project name" />
            <Button type="submit" loading={projectBusy} disabled={!newProject.trim()}>
              Add
            </Button>
          </form>
        ) : null}
      </Card>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function QuestionsTab({ project, canModerate }: { project: Project; canModerate: boolean }) {
  const { notify } = useToast()
  const [items, setItems] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<'short' | 'long' | 'rating' | 'company'>('long')
  const [required, setRequired] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await contentApi.listQuestions(project.id)
      setItems(res.items)
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    void load()
  }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setBusy(true)
    try {
      await contentApi.createQuestion(project.id, { label: label.trim(), type, required })
      setLabel('')
      setRequired(false)
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not add question.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(qid: string) {
    try {
      await contentApi.deleteQuestion(qid)
      setItems((prev) => prev.filter((q) => q.id !== qid))
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete question.', 'error')
    }
  }

  if (!canModerate) {
    return <Card className="card-pad"><EmptyState title="No access" description="Only owners, admins and managers can manage questions." /></Card>
  }

  return (
    <Card className="card-pad">
      <h3 className="section-title">Custom questions · {project.name}</h3>
      <p className="muted">These are asked on the collection form for this project.</p>
      {loading ? (
        <div className="list-loading"><Spinner label="Loading questions" /></div>
      ) : items.length === 0 ? (
        <p className="muted">No custom questions yet — the default form collects name, rating and a comment.</p>
      ) : (
        <ul className="item-list">
          {items.map((q) => (
            <li key={q.id} className="item-row">
              <div>
                <strong>{q.label}</strong>
                <span className="muted"> · {q.type}{q.required ? ' · required' : ''}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => remove(q.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="inline-form q-form">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. What result did you see?" />
        <select className="input input-select" value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Question type">
          <option value="short">Short text</option>
          <option value="long">Long text</option>
          <option value="rating">Rating</option>
          <option value="company">Company</option>
        </select>
        <label className="check-inline">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
        <Button type="submit" loading={busy} disabled={!label.trim()}>
          Add
        </Button>
      </form>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */

const WIDGET_STATUS_LABEL: Record<WidgetConfig['status'], string> = {
  draft: 'Draft',
  live: 'Live',
  archived: 'Archived',
}

function WidgetsTab({ project, client, canModerate }: { project: Project; client: Client; canModerate: boolean }) {
  const { notify } = useToast()
  const [items, setItems] = useState<WidgetConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await contentApi.listWidgets(project.id)
      setItems(res.items)
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    void load()
  }, [load])

  async function copyEmbed(widget: WidgetConfig) {
    if (widget.status !== 'live') {
      notify('Publish this widget before embedding it.', 'error')
      return
    }
    const ok = await copyText(widgetEmbedSnippet(widget.publicId))
    notify(ok ? 'Embed code copied.' : 'Could not access the clipboard.', ok ? 'success' : 'error')
  }

  async function duplicate(widget: WidgetConfig) {
    setBusy(true)
    try {
      await contentApi.duplicateWidget(widget.id)
      notify('Duplicated as a draft.', 'success')
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not duplicate that widget.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(widget: WidgetConfig, status: WidgetConfig['status']) {
    setBusy(true)
    try {
      await contentApi.updateWidget(widget.id, { status })
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update that widget.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!canModerate) {
    return (
      <Card className="card-pad">
        <EmptyState title="No access" description="Only owners, admins and managers can manage widgets." />
      </Card>
    )
  }

  return (
    <Card className="card-pad stack">
      <div className="section-title-row">
        <h3 className="section-title">Widgets · {project.name}</h3>
        <Link className="btn btn-primary btn-sm" to={`/widgets?clientId=${client.id}&new=1`}>
          New widget
        </Link>
      </div>
      <p className="muted">Saved display configurations for this project. Edit, embed or duplicate them here.</p>
      {loading ? (
        <div className="list-loading">
          <Spinner label="Loading widgets" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Turn approved feedback into social proof"
          description="Create a widget to show this project's approved testimonials on a website."
          action={
            <Link className="btn btn-primary btn-sm" to={`/widgets?clientId=${client.id}&new=1`}>
              Create a widget
            </Link>
          }
        />
      ) : (
        <ul className="widget-list">
          {items.map((widget) => (
            <li key={widget.id} className="widget-row">
              <div className="widget-row-main">
                <div className="widget-row-title">
                  <strong>{widget.name}</strong>
                  <span className={`badge badge-${widget.status}`}>{WIDGET_STATUS_LABEL[widget.status]}</span>
                </div>
                <span className="muted">
                  {widget.layout} · {widget.theme} · up to {widget.max}
                </span>
              </div>
              <div className="widget-actions">
                <Link className="btn btn-ghost btn-sm" to={`/widgets?widgetId=${widget.id}`}>
                  Edit
                </Link>
                <Button variant="ghost" size="sm" onClick={() => copyEmbed(widget)}>
                  Embed
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => duplicate(widget)}>
                  Duplicate
                </Button>
                {widget.status === 'live' ? (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStatus(widget, 'draft')}>
                    Unpublish
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStatus(widget, 'live')}>
                    Publish
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------------------- */

function AnalyticsTab({ project }: { project: Project }) {
  const { notify } = useToast()
  const [totals, setTotals] = useState<{ total: number; pending: number; approved: number; rejected: number; averageRating: number; approvalRate: number | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [importResult, setImportResult] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await contentApi.projectAnalytics(project.id)
      setTotals(res.totals)
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    void load()
  }, [load])

  function download() {
    const a = document.createElement('a')
    a.href = contentApi.exportCsvUrl(project.id)
    a.download = `${project.slug}-testimonials.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function parseAndImport() {
    const rows = csvText
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => {
        const [name, company, rating, status, , , text] = line.split(',')
        return { name: (name ?? '').replace(/^"|"$/g, ''), company: (company ?? '').replace(/^"|"$/g, ''), rating: (rating ?? '').replace(/^"|"$/g, ''), text: (text ?? '').replace(/^"|"$/g, ''), status: (status ?? '').replace(/^"|"$/g, '') }
      })
      .filter((r) => r.name && r.text)
    if (rows.length === 0) {
      setImportResult('No rows found. Expected columns: name, company, rating, status, created_at, approved_at, content, tags.')
      return
    }
    setImporting(true)
    try {
      const res = await contentApi.importCsv(project.id, rows, true)
      setImportResult(`Imported ${res.imported ?? 0} testimonial${res.imported === 1 ? '' : 's'}.`)
      setCsvText('')
      await load()
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Card className="card-pad">
      <h3 className="section-title">Analytics · {project.name}</h3>
      {loading || !totals ? (
        <div className="list-loading"><Spinner label="Loading analytics" /></div>
      ) : (
        <div className="stats-grid">
          <div className="stat-card"><p className="stat-label">Total</p><p className="stat-value">{totals.total}</p></div>
          <div className="stat-card stat-card-accent"><p className="stat-label">Pending</p><p className="stat-value">{totals.pending}</p></div>
          <div className="stat-card"><p className="stat-label">Approved</p><p className="stat-value">{totals.approved}</p></div>
          <div className="stat-card"><p className="stat-label">Avg rating</p><p className="stat-value">{totals.approved > 0 ? totals.averageRating.toFixed(1) : '—'}</p></div>
        </div>
      )}
      <div className="csv-actions">
        <Button variant="outline" size="sm" onClick={download}>Export CSV</Button>
        <span className="muted">Import requires columns: name, company, rating, status, created_at, approved_at, content, tags.</span>
      </div>
      <div className="csv-import">
        <Textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder="Paste CSV rows (without the header) to import…" rows={4} />
        <div className="csv-import-actions">
          <Button variant="subtle" size="sm" loading={importing} disabled={!csvText.trim()} onClick={parseAndImport}>
            Import
          </Button>
          {importResult ? <span className="muted">{importResult}</span> : null}
        </div>
      </div>
    </Card>
  )
}
