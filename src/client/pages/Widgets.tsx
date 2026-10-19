import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  contentApi,
  copyText,
  widgetEmbedSnippet,
  workspaceApi,
  type Client,
  type Project,
  type Tag,
  type WidgetConfig,
  type WidgetStatus,
} from '../api'
import { AppBar } from '../components/AppBar'
import { Button, Card, EmptyState, Field, Input, Spinner } from '../components/Primitives'
import { useToast } from '../components/Toast'
import { WidgetPreview } from '../components/WidgetPreview'
import { LAYOUTS } from '../../widget/options'
import type { WidgetLayout, WidgetOptions, WidgetTheme } from '../../widget/types'

const STATUS_LABEL: Record<WidgetStatus, string> = {
  draft: 'Draft',
  live: 'Live',
  archived: 'Archived',
}

const LAYOUT_COPY: Record<WidgetLayout, { title: string; body: string }> = {
  grid: { title: 'Grid', body: 'A responsive wall of cards. Good for testimonials or pricing pages.' },
  carousel: { title: 'Carousel', body: 'One card at a time with keyboard-friendly controls.' },
  single: { title: 'Single', body: 'One featured testimonial, larger type.' },
  compact: { title: 'Compact', body: 'A quiet list for sidebars and footers.' },
}

type Editor = {
  id: string | null
  publicId: string
  clientId: string
  projectId: string
  name: string
  layout: WidgetLayout
  theme: WidgetTheme
  accent: string
  showStars: boolean
  showCompany: boolean
  max: number
  minRating: number | null
  tagId: string | null
  status: WidgetStatus
}

const EMPTY_EDITOR: Editor = {
  id: null,
  publicId: '',
  clientId: '',
  projectId: '',
  name: '',
  layout: 'grid',
  theme: 'light',
  accent: '#15803d',
  showStars: true,
  showCompany: true,
  max: 9,
  minRating: null,
  tagId: null,
  status: 'draft',
}

/** Owner-facing saved-widget hub: list, create, edit, embed, duplicate, archive. */
export function Widgets() {
  const { notify } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [widgets, setWidgets] = useState<WidgetConfig[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | WidgetStatus>(() => {
    const status = searchParams.get('status')
    return status === 'draft' || status === 'live' || status === 'archived' ? status : 'all'
  })
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)
  const handledDeepLink = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [w, c, p, t] = await Promise.all([
        contentApi.listWorkspaceWidgets(),
        workspaceApi.listClients(),
        workspaceApi.listProjects(),
        contentApi.listTags(),
      ])
      setWidgets(w.items)
      setClients(c.items)
      setProjects(p.items)
      setTags(t.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not load your widgets.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Deep links from the client detail page: ?clientId=…&new=1 or ?widgetId=…
  useEffect(() => {
    if (handledDeepLink.current || loading) return
    const widgetId = searchParams.get('widgetId')
    const newFor = searchParams.get('clientId')
    const isNew = searchParams.get('new') === '1'
    if (widgetId) {
      const widget = widgets.find((item) => item.id === widgetId)
      if (widget) {
        handledDeepLink.current = true
        setEditor(editorFromWidget(widget))
      }
    } else if (isNew && newFor) {
      handledDeepLink.current = true
      const project = projects.find((p) => p.clientId === newFor && p.isDefault) ?? projects.find((p) => p.clientId === newFor)
      const client = clients.find((c) => c.id === newFor)
      setEditor({ ...EMPTY_EDITOR, clientId: newFor, projectId: project?.id ?? '', accent: client?.accentColor ?? '#15803d' })
    }
  }, [loading, widgets, clients, projects, searchParams])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return widgets.filter((w) => {
      if (filter !== 'all' && w.status !== filter) return false
      if (!term) return true
      return `${w.name} ${w.clientName ?? ''} ${w.projectName ?? ''}`.toLowerCase().includes(term)
    })
  }, [widgets, filter, search])

  const counts = useMemo(() => {
    return {
      all: widgets.length,
      draft: widgets.filter((w) => w.status === 'draft').length,
      live: widgets.filter((w) => w.status === 'live').length,
      archived: widgets.filter((w) => w.status === 'archived').length,
    }
  }, [widgets])

  function openCreate() {
    const client = clients[0]
    const project = projects.find((p) => p.clientId === client?.id && p.isDefault) ?? projects.find((p) => p.clientId === client?.id)
    setEditor({
      ...EMPTY_EDITOR,
      clientId: client?.id ?? '',
      projectId: project?.id ?? '',
      accent: client?.accentColor ?? '#15803d',
    })
  }

  function closeEditor() {
    setEditor(null)
    if (searchParams.has('widgetId') || searchParams.has('new')) {
      const next = new URLSearchParams(searchParams)
      next.delete('widgetId')
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }

  function editWidget(widget: WidgetConfig) {
    setEditor(editorFromWidget(widget))
  }

  async function save(publish: boolean) {
    if (!editor) return
    if (!editor.name.trim()) {
      notify('Give the widget a name.', 'error')
      return
    }
    if (!editor.projectId) {
      notify('Choose a project for this widget.', 'error')
      return
    }
    setBusy(true)
    try {
      const body = {
        name: editor.name.trim(),
        layout: editor.layout,
        theme: editor.theme,
        accent: editor.accent,
        showStars: editor.showStars,
        showCompany: editor.showCompany,
        max: editor.max,
        minRating: editor.minRating,
        tagId: editor.tagId,
      }
      if (editor.id) {
        await contentApi.updateWidget(editor.id, { ...body, status: publish ? 'live' : editor.status })
        notify(publish ? 'Widget published.' : 'Widget saved.', 'success')
      } else {
        await contentApi.createWidget(editor.projectId, { ...body, status: publish ? 'live' : 'draft' })
        notify(publish ? 'Widget published.' : 'Widget saved as a draft.', 'success')
      }
      await load()
      closeEditor()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save the widget.', 'error')
    } finally {
      setBusy(false)
    }
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

  async function setStatus(widget: WidgetConfig, status: WidgetStatus) {
    setBusy(true)
    try {
      await contentApi.updateWidget(widget.id, { status })
      notify(status === 'live' ? 'Widget published.' : status === 'archived' ? 'Widget archived.' : 'Widget moved to draft.', 'success')
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update that widget.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(widget: WidgetConfig) {
    if (!window.confirm(`Delete “${widget.name}”? This cannot be undone.`)) return
    setBusy(true)
    try {
      await contentApi.deleteWidget(widget.id)
      notify('Widget deleted.', 'success')
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not delete that widget.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function copyEmbed(widget: WidgetConfig) {
    if (widget.status !== 'live') {
      notify('Publish this widget before embedding it.', 'error')
      return
    }
    const ok = await copyText(widgetEmbedSnippet(widget.publicId))
    notify(ok ? 'Embed code copied.' : 'Could not access the clipboard — copy it manually.', ok ? 'success' : 'error')
  }

  return (
    <div className="app-shell">
      <AppBar />
      <main className="container">
        <div className="page-head page-head-row">
          <div>
            <h1>Widgets</h1>
            <p>Turn approved feedback into social proof. Each saved widget has a stable embed you can drop onto any site.</p>
          </div>
          <div className="row-actions">
            <Button variant="primary" size="sm" onClick={openCreate} disabled={clients.length === 0}>
              New widget
            </Button>
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

        {editor ? (
          <WidgetEditor
            editor={editor}
            setEditor={setEditor}
            clients={clients}
            projects={projects}
            tags={tags}
            busy={busy}
            onSave={save}
            onCancel={closeEditor}
          />
        ) : null}

        {loading ? (
          <div className="list-loading">
            <Spinner label="Loading widgets" />
          </div>
        ) : clients.length === 0 ? (
          <EmptyState
            title="Add a client first"
            description="Widgets belong to a client's project. Create a client, then come back to build your first widget."
            action={
              <a className="btn btn-primary" href="/clients">
                Go to clients
              </a>
            }
          />
        ) : widgets.length === 0 ? (
          <EmptyState
            title="Turn approved feedback into social proof"
            description="Create a widget, choose the testimonials it shows, then paste one snippet onto your site."
            action={<Button variant="primary" onClick={openCreate}>Create your first widget</Button>}
          />
        ) : (
          <section className="card card-pad stack">
            <div className="filter-bar">
              <div className="tabs" role="tablist" aria-label="Filter widgets">
                {(['all', 'draft', 'live', 'archived'] as const).map((key) => (
                  <button
                    key={key}
                    role="tab"
                    type="button"
                    aria-selected={filter === key}
                    className={`tab ${filter === key ? 'tab-on' : ''}`.trim()}
                    onClick={() => setFilter(key)}
                  >
                    {key === 'all' ? 'All' : STATUS_LABEL[key]}
                    <span className="tab-count">{counts[key]}</span>
                  </button>
                ))}
              </div>
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search widgets"
                aria-label="Search widgets"
                className="input-search"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="muted">No widgets match this filter.</p>
            ) : (
              <ul className="widget-list">
                {filtered.map((widget) => (
                  <li key={widget.id} className="widget-row">
                    <div className="widget-row-main">
                      <div className="widget-row-title">
                        <strong>{widget.name}</strong>
                        <span className={`badge badge-${widget.status}`}>{STATUS_LABEL[widget.status]}</span>
                      </div>
                      <span className="muted">
                        {widget.clientName ?? 'Client'} · {widget.projectName ?? 'Project'} · {widget.layout} · up to{' '}
                        {widget.max}
                      </span>
                    </div>
                    <div className="widget-actions">
                      <Button variant="ghost" size="sm" onClick={() => editWidget(widget)}>
                        Edit
                      </Button>
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
                      {widget.status === 'archived' ? null : (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setStatus(widget, 'archived')}>
                          Archive
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="btn-danger-text"
                        disabled={busy}
                        onClick={() => remove(widget)}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

function editorFromWidget(widget: WidgetConfig): Editor {
  return {
    id: widget.id,
    publicId: widget.publicId,
    clientId: widget.clientId ?? '',
    projectId: widget.projectId,
    name: widget.name,
    layout: widget.layout,
    theme: widget.theme,
    accent: widget.accent,
    showStars: widget.showStars,
    showCompany: widget.showCompany,
    max: widget.max,
    minRating: widget.minRating,
    tagId: widget.tagId,
    status: widget.status,
  }
}

function WidgetEditor({
  editor,
  setEditor,
  clients,
  projects,
  tags,
  busy,
  onSave,
  onCancel,
}: {
  editor: Editor
  setEditor: (editor: Editor) => void
  clients: Client[]
  projects: Project[]
  tags: Tag[]
  busy: boolean
  onSave: (publish: boolean) => void
  onCancel: () => void
}) {
  const client = clients.find((c) => c.id === editor.clientId) ?? null
  const clientProjects = projects.filter((p) => p.clientId === editor.clientId)
  const update = (patch: Partial<Editor>) => setEditor({ ...editor, ...patch })

  const previewOptions: WidgetOptions = {
    slug: client?.slug ?? '',
    layout: editor.layout,
    theme: editor.theme,
    accent: editor.accent,
    accentExplicit: true,
    showStars: editor.showStars,
    showCompany: editor.showCompany,
    max: editor.max,
  }

  function pickClient(clientId: string) {
    const next = clients.find((c) => c.id === clientId)
    const project = projects.find((p) => p.clientId === clientId && p.isDefault) ?? projects.find((p) => p.clientId === clientId)
    update({
      clientId,
      projectId: project?.id ?? '',
      accent: next?.accentColor ?? editor.accent,
    })
  }

  return (
    <Card className="card-pad editor-panel">
      <div className="section-title-row">
        <h2 className="section-title">{editor.id ? 'Edit widget' : 'New widget'}</h2>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Close
        </Button>
      </div>

      <div className="widgets-layout">
        <div className="stack">
          <div className="form-grid">
            <Field label="Widget name" htmlFor="w-name">
              <Input
                id="w-name"
                value={editor.name}
                onChange={(event) => update({ name: event.target.value })}
                placeholder="Homepage testimonials"
                maxLength={60}
              />
            </Field>
            <Field label="Client" htmlFor="w-client">
              <select
                id="w-client"
                className="input input-select"
                value={editor.clientId}
                onChange={(event) => pickClient(event.target.value)}
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project" htmlFor="w-project">
              <select
                id="w-project"
                className="input input-select"
                value={editor.projectId}
                onChange={(event) => update({ projectId: event.target.value })}
              >
                {clientProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <h3 className="section-title">Layout</h3>
          <div className="widget-choices">
            {LAYOUTS.map((value) => (
              <button
                key={value}
                type="button"
                className={`widget-choice ${editor.layout === value ? 'widget-choice-on' : ''}`.trim()}
                aria-pressed={editor.layout === value}
                onClick={() => update({ layout: value })}
              >
                <strong>{LAYOUT_COPY[value].title}</strong>
                <span className="muted">{LAYOUT_COPY[value].body}</span>
              </button>
            ))}
          </div>

          <h3 className="section-title">Appearance</h3>
          <div className="widget-option-row">
            <span className="link-label">Theme</span>
            <div className="widget-inline-options">
              {(['light', 'dark'] as WidgetTheme[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`chip-btn ${editor.theme === value ? 'chip-btn-on' : ''}`.trim()}
                  aria-pressed={editor.theme === value}
                  onClick={() => update({ theme: value })}
                >
                  {value === 'light' ? 'Light' : 'Dark'}
                </button>
              ))}
            </div>
          </div>

          <div className="widget-option-row">
            <span className="link-label">Accent</span>
            <div className="widget-inline-options">
              <input
                className="input widget-accent-input"
                type="color"
                aria-label="Widget accent colour"
                value={editor.accent}
                onChange={(event) => update({ accent: event.target.value })}
              />
              {client ? (
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => update({ accent: client.accentColor })}
                >
                  Use client accent
                </button>
              ) : null}
            </div>
          </div>

          <div className="widget-option-row">
            <span className="link-label">Show rating stars</span>
            <button
              type="button"
              className={`chip-btn ${editor.showStars ? 'chip-btn-on' : ''}`.trim()}
              aria-pressed={editor.showStars}
              onClick={() => update({ showStars: !editor.showStars })}
            >
              {editor.showStars ? 'On' : 'Off'}
            </button>
          </div>

          <div className="widget-option-row">
            <span className="link-label">Show company</span>
            <button
              type="button"
              className={`chip-btn ${editor.showCompany ? 'chip-btn-on' : ''}`.trim()}
              aria-pressed={editor.showCompany}
              onClick={() => update({ showCompany: !editor.showCompany })}
            >
              {editor.showCompany ? 'On' : 'Off'}
            </button>
          </div>

          <div className="form-grid">
            <Field label="Testimonials shown" htmlFor="w-max">
              <Input
                id="w-max"
                type="number"
                min={1}
                max={50}
                value={editor.max}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10)
                  update({ max: Number.isFinite(parsed) ? Math.min(50, Math.max(1, parsed)) : 9 })
                }}
              />
            </Field>
            <Field label="Minimum rating" htmlFor="w-min" optional>
              <select
                id="w-min"
                className="input input-select"
                value={editor.minRating ?? ''}
                onChange={(event) => update({ minRating: event.target.value ? Number(event.target.value) : null })}
              >
                <option value="">Any rating</option>
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value}+ stars
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Only this tag" htmlFor="w-tag" optional>
              <select
                id="w-tag"
                className="input input-select"
                value={editor.tagId ?? ''}
                onChange={(event) => update({ tagId: event.target.value || null })}
              >
                <option value="">Any tag</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="form-actions">
            <Button onClick={() => onSave(false)} loading={busy} disabled={!editor.name.trim() || !editor.projectId}>
              {editor.id ? 'Save changes' : 'Save draft'}
            </Button>
            <Button variant="outline" onClick={() => onSave(true)} loading={busy} disabled={!editor.name.trim() || !editor.projectId}>
              {editor.status === 'live' ? 'Save & keep live' : 'Save & publish'}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>

          {editor.id ? (
            <div className="embed-block">
              <h3 className="section-title">Embed</h3>
              {editor.status === 'live' ? (
                <>
                  <p className="muted">
                    Paste this once. Editing the widget updates every site using it — no need to re-paste.
                  </p>
                  <pre className="embed-code">
                    <code>{widgetEmbedSnippet(editor.publicId)}</code>
                  </pre>
                </>
              ) : (
                <p className="muted">Publish this widget to get an embed snippet.</p>
              )}
            </div>
          ) : null}
        </div>

        <div className="card card-pad stack">
          <h3 className="section-title">Live preview</h3>
          {client ? (
            <WidgetPreview slug={client.slug} options={previewOptions} />
          ) : (
            <p className="muted">Choose a client to preview the widget.</p>
          )}
        </div>
      </div>
    </Card>
  )
}
