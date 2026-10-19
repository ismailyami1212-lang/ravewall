/** Typed wrapper around the JSON API. */

const STORAGE_KEY = 'ravewall.workspace'

/** The workspace every API request is scoped to. Set by the session provider. */
let activeWorkspaceId: string | null = null

/** Persist + activate a workspace so the next requests carry x-workspace-id. */
export function setActiveWorkspaceId(id: string | null) {
  activeWorkspaceId = id || null
  try {
    if (activeWorkspaceId) localStorage.setItem(STORAGE_KEY, activeWorkspaceId)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* private mode — non-fatal */
  }
}

/** Current active workspace id (used by the session provider to avoid stale closures). */
export function getActiveWorkspaceId(): string | null {
  return activeWorkspaceId
}

/** Restore the saved workspace id (called once before the app boots). */
export function restoreActiveWorkspaceId() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) activeWorkspaceId = saved
  } catch {
    /* ignore */
  }
  return activeWorkspaceId
}

export type Role = 'owner' | 'admin' | 'manager' | 'viewer'

export type Membership = {
  id: string
  workspaceId: string
  userId: string
  role: Role
  status: string
  workspaceName: string
  plan: string
  createdAt: string
}

export type Workspace = {
  id: string
  name: string
  plan: string
  createdAt?: string | null
}

export type Client = {
  id: string
  workspaceId: string
  ownerId: string
  name: string
  slug: string
  tagline: string
  logoUrl: string
  accentColor: string
  createdAt: string | null
  updatedAt: string | null
}

export type Project = {
  id: string
  workspaceId: string
  clientId: string
  clientName?: string
  name: string
  slug: string
  isDefault: boolean
  createdAt: string | null
  updatedAt: string | null
}

export type TeamMember = {
  id: string
  workspaceId: string
  userId: string
  role: Role
  status: string
  name: string | null
  email: string | null
  clientIds: string[]
  createdAt: string | null
}

export type Tag = { id: string; name: string; createdAt: string | null }
export type Question = {
  id: string
  projectId: string
  label: string
  type: 'short' | 'long' | 'rating' | 'company'
  required: boolean
  position: number
}
export type WidgetStatus = 'draft' | 'live' | 'archived'
export type WidgetConfig = {
  id: string
  projectId: string
  name: string
  layout: 'grid' | 'carousel' | 'single' | 'compact'
  theme: 'light' | 'dark'
  accent: string
  showStars: boolean
  showCompany: boolean
  max: number
  minRating: number | null
  tagId: string | null
  publicId: string
  status: WidgetStatus
  createdBy: string | null
  createdAt: string | null
  updatedAt: string | null
  /** Present on workspace-wide listings. */
  clientId?: string
  clientName?: string
  clientSlug?: string
  projectName?: string
}

/** Per-client operational counts (Clients page). */
export type ClientSummary = {
  id: string
  projects: number
  testimonials: number
  pending: number
  approved: number
  widgets: number
  liveWidgets: number
}

/** Per-project counts (client overview). */
export type ProjectSummary = {
  id: string
  testimonials: number
  pending: number
  approved: number
  widgets: number
  liveWidgets: number
}

export type Business = {
  id: string
  name: string
  slug: string
  tagline: string
  logoUrl: string
  accentColor: string
  createdAt: string
  updatedAt: string
}

export type TestimonialStatus = 'pending' | 'approved' | 'rejected'

export type Testimonial = {
  id: string
  rating: number
  name: string
  company: string
  text: string
  status: TestimonialStatus
  createdAt: string
  updatedAt: string
}

export type WallTestimonial = Omit<Testimonial, 'status' | 'updatedAt'>

export type Stats = {
  total: number
  pending: number
  approved: number
  rejected: number
  averageRating: number
  lastSubmissionAt: string | null
}

export type SessionUser = {
  id: string
  email: string
  name: string
  createdAt: string
}

export type Me = {
  user: SessionUser | null
  business: Business | null
  workspace: Workspace | null
  role: Role | null
  memberships: Membership[]
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields?: Record<string, string>

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  // Scope every API call to the active workspace when one is selected.
  if (activeWorkspaceId) headers.set('x-workspace-id', activeWorkspaceId)

  let response: Response
  try {
    response = await fetch(`/api${path}`, { credentials: 'same-origin', ...init, headers })
  } catch {
    throw new ApiError(0, 'network', 'We could not reach the server. Check your connection.')
  }

  if (response.status === 204) return undefined as T

  const raw = await response.text()
  let payload: { data?: unknown; error?: { code?: string; message?: string; fields?: Record<string, string> } } | null =
    null
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const error = payload?.error
    throw new ApiError(
      response.status,
      error?.code ?? 'error',
      error?.message ?? `Request failed with status ${response.status}.`,
      error?.fields,
    )
  }

  return payload?.data as T
}

const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) })
const patch = (body: unknown) => ({ method: 'PATCH', body: JSON.stringify(body) })

export const api = {
  me: () => request<Me>('/auth/me'),

  signup: (body: { email: string; password: string; name: string }) =>
    request<{ user: SessionUser; business: Business | null }>('/auth/signup', post(body)),

  login: (body: { email: string; password: string }) =>
    request<{ user: SessionUser; business: Business | null }>('/auth/login', post(body)),

  forgotPassword: (body: { email: string }) =>
    request<{ ok: boolean; message: string }>('/auth/forgot-password', post(body)),

  resetPassword: (body: { token: string; password: string }) =>
    request<{ ok: boolean; sessionsEnded: number }>('/auth/reset-password', post(body)),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  slugAvailable: (slug: string) =>
    request<{ slug: string; available: boolean }>(
      `/business/slug-available?slug=${encodeURIComponent(slug)}`,
    ),

  createBusiness: (body: {
    name: string
    slug: string
    tagline?: string
    logoUrl?: string
    accentColor?: string
  }) => request<{ business: Business }>('/business', post(body)),

  updateBusiness: (body: Record<string, unknown>) =>
    request<{ business: Business }>('/business', patch(body)),

  /** Appends client/project scope to a path when provided (used for the agency inbox). */
  scopeQuery: (opts?: { clientId?: string; projectId?: string }) => {
    const search = new URLSearchParams()
    if (opts?.clientId) search.set('clientId', opts.clientId)
    if (opts?.projectId) search.set('projectId', opts.projectId)
    const query = search.toString()
    return query ? `?${query}` : ''
  },

  listTestimonials: (params: { status?: string; q?: string; sort?: string; clientId?: string; projectId?: string } = {}) => {
    const search = new URLSearchParams()
    if (params.status) search.set('status', params.status)
    if (params.q) search.set('q', params.q)
    if (params.sort) search.set('sort', params.sort)
    if (params.clientId) search.set('clientId', params.clientId)
    if (params.projectId) search.set('projectId', params.projectId)
    const query = search.toString()
    return request<{ items: Testimonial[]; stats: Stats }>(
      `/testimonials${query ? `?${query}` : ''}`,
    )
  },

  moderate: (id: string, status: TestimonialStatus, opts?: { clientId?: string; projectId?: string }) =>
    request<{ testimonial: Testimonial; stats: Stats }>(
      `/testimonials/${encodeURIComponent(id)}${api.scopeQuery(opts)}`,
      patch({ status }),
    ),

  remove: (id: string, opts?: { clientId?: string; projectId?: string }) =>
    request<{ id: string; stats: Stats }>(`/testimonials/${encodeURIComponent(id)}${api.scopeQuery(opts)}`, {
      method: 'DELETE',
    }),

  publicBusiness: (slug: string) =>
    request<{ business: Business }>(`/public/business/${encodeURIComponent(slug)}`),

  wall: (slug: string) =>
    request<{ business: Business; testimonials: WallTestimonial[]; stats: { count: number; averageRating: number } }>(
      `/public/wall/${encodeURIComponent(slug)}`,
    ),

  submitTestimonial: (
    slug: string,
    body: { rating: number; name: string; company?: string; text: string; website?: string },
  ) =>
    request<{ accepted: boolean; status: TestimonialStatus }>(
      `/public/submit/${encodeURIComponent(slug)}`,
      post(body),
    ),
}

/* -------------------------------------------------------------------------- */
/* Workspace / agency surface                                                  */
/* -------------------------------------------------------------------------- */

export const workspaceApi = {
  info: () => request<{ workspace: Workspace; role: Role; memberships: Membership[]; counts: { clients: number; projects: number } }>('/workspace/'),

  rename: (name: string) => request<{ workspace: Workspace }>('/workspace/', patch({ name })),

  listClients: () => request<{ items: Client[] }>('/workspace/clients'),
  clientsSummary: () => request<{ items: ClientSummary[] }>('/workspace/clients/summary'),
  createClient: (body: { name: string; slug?: string }) =>
    request<{ client: Client }>('/workspace/clients', post(body)),
  updateClient: (id: string, body: { name?: string; slug?: string; tagline?: string; logoUrl?: string; accentColor?: string }) =>
    request<{ client: Client }>(`/workspace/clients/${encodeURIComponent(id)}`, patch(body)),
  deleteClient: (id: string) =>
    request<void>(`/workspace/clients/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getClient: (id: string) =>
    request<{ client: Client; projects: Project[] }>(`/workspace/clients/${encodeURIComponent(id)}`),

  listProjects: () => request<{ items: Project[] }>('/workspace/projects'),
  projectsSummary: () => request<{ items: ProjectSummary[] }>('/workspace/projects/summary'),
  createProject: (clientId: string, body: { name: string; slug?: string }) =>
    request<{ project: Project }>(`/workspace/clients/${encodeURIComponent(clientId)}/projects`, post(body)),
  updateProject: (id: string, body: { name?: string; slug?: string }) =>
    request<{ project: Project }>(`/workspace/projects/${encodeURIComponent(id)}`, patch(body)),
  deleteProject: (id: string) =>
    request<void>(`/workspace/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listTeam: () => request<{ items: TeamMember[]; clients: { id: string; name: string }[] }>('/workspace/team'),
  addMember: (body: { email: string; role: Role }) =>
    request<{ member: TeamMember & { name: string; email: string } }>('/workspace/team', post(body)),
  updateMemberRole: (userId: string, role: Role) =>
    request<{ member: TeamMember }>(`/workspace/team/${encodeURIComponent(userId)}`, patch({ role })),
  removeMember: (userId: string) =>
    request<void>(`/workspace/team/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  setMemberClients: (userId: string, clientIds: string[]) =>
    request<{ clientIds: string[] }>(`/workspace/team/${encodeURIComponent(userId)}/clients`, {
      method: 'PUT',
      body: JSON.stringify({ clientIds }),
    }),
}

export const contentApi = {
  listTags: () => request<{ items: Tag[] }>('/projects/tags'),
  createTag: (name: string) => request<{ tag: Tag }>('/projects/tags', post({ name })),
  deleteTag: (id: string) => request<void>(`/projects/tags/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listQuestions: (projectId: string) =>
    request<{ items: Question[] }>(`/projects/projects/${encodeURIComponent(projectId)}/questions`),
  createQuestion: (projectId: string, body: { label: string; type?: string; required?: boolean }) =>
    request<{ question: Question }>(`/projects/projects/${encodeURIComponent(projectId)}/questions`, post(body)),
  updateQuestion: (id: string, body: { label?: string; type?: string; required?: boolean; position?: number }) =>
    request<{ question: Question }>(`/projects/questions/${encodeURIComponent(id)}`, patch(body)),
  deleteQuestion: (id: string) =>
    request<void>(`/projects/questions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listWidgets: (projectId: string) =>
    request<{ items: WidgetConfig[] }>(`/projects/projects/${encodeURIComponent(projectId)}/widgets`),
  createWidget: (projectId: string, body: Record<string, unknown>) =>
    request<{ widget: WidgetConfig }>(`/projects/projects/${encodeURIComponent(projectId)}/widgets`, post(body)),
  /** Workspace-wide list for the operational Widgets page. */
  listWorkspaceWidgets: () => request<{ items: WidgetConfig[] }>('/projects/widgets'),
  getWidget: (id: string) => request<{ widget: WidgetConfig }>(`/projects/widgets/${encodeURIComponent(id)}`),
  updateWidget: (id: string, body: Record<string, unknown>) =>
    request<{ widget: WidgetConfig }>(`/projects/widgets/${encodeURIComponent(id)}`, patch(body)),
  duplicateWidget: (id: string) =>
    request<{ widget: WidgetConfig }>(`/projects/widgets/${encodeURIComponent(id)}/duplicate`, post({})),
  deleteWidget: (id: string) =>
    request<void>(`/projects/widgets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  projectAnalytics: (projectId: string) =>
    request<{
      project: { id: string; name: string; slug: string }
      totals: { total: number; pending: number; approved: number; rejected: number; averageRating: number; approvalRate: number | null }
      trend: { day: string; count: number }[]
    }>(`/projects/projects/${encodeURIComponent(projectId)}/analytics`),

  workspaceAnalytics: () =>
    request<{
      clients: number
      projects: number
      testimonials: number
      thisMonth: number
      pending: number
      approved: number
      widgets: { total: number; live: number; draft: number; archived: number }
      topClients: { id: string; name: string; accentColor: string; approved: number; pending: number }[]
      trend: { day: string; count: number }[]
    }>('/projects/analytics'),

  /** Returns a same-origin URL that downloads the CSV (carries the workspace via ?workspace=). */
  exportCsvUrl: (projectId: string) =>
    `/api/projects/projects/${encodeURIComponent(projectId)}/export.csv${
      activeWorkspaceId ? `?workspace=${encodeURIComponent(activeWorkspaceId)}` : ''
    }`,

  importCsv: (
    projectId: string,
    rows: Record<string, string>[],
    commit: boolean,
  ) =>
    request<{ preview?: Record<string, string>[]; total?: number; errors: { row: number; problems: string }[]; committed: boolean; imported?: number }>(
      `/projects/projects/${encodeURIComponent(projectId)}/import`,
      post({ rows, commit }),
    ),
}

export const accountApi = {
  get: () => request<{ user: { id: string; name: string; email: string; createdAt: string }; workspace: Workspace | null; role: Role | null }>('/account'),
  update: (body: { name?: string; email?: string }) => request<{ user: { id: string; name: string; email: string; createdAt: string } }>('/account', patch(body)),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean; otherSessionsEnded: number }>('/account/password', post(body)),
  sessions: () => request<{ items: { id: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean }[] }>('/account/sessions'),
  revokeSession: (id: string) => request<void>(`/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revokeOtherSessions: () => request<{ ended: number }>('/account/sessions', { method: 'DELETE' }),
  deleteAccount: (password: string) => request<void>('/account', { method: 'DELETE', body: JSON.stringify({ password }) }),
}

/** Absolute share URL for a slug, independent of the current route. */
export function collectUrl(slug: string) {
  return `${window.location.origin}/t/${slug}`
}

export function wallUrl(slug: string) {
  return `${window.location.origin}/wall/${slug}`
}

/**
 * Embed snippet for a saved widget. It references the widget's stable public id,
 * so later edits in the dashboard reach every site that pasted this snippet.
 */
export function widgetEmbedSnippet(publicId: string) {
  const origin = typeof window === 'undefined' ? 'https://ravewall.vercel.app' : window.location.origin
  return [
    `<script src="${origin}/widget/ravewall-widget.js" async></script>`,
    `<div data-ravewall-widget data-rw-widget="${publicId}"></div>`,
  ].join('\n')
}

/** Copies text to the clipboard, with a fallback for non-secure contexts. */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/** Plain-text rendering of a testimonial, used by the copy action. */
export function testimonialToText(testimonial: {
  text: string
  name: string
  company?: string
  rating: number
}): string {
  const attribution = testimonial.company
    ? `${testimonial.name}, ${testimonial.company}`
    : testimonial.name
  return `"${testimonial.text}"\n— ${attribution} (${testimonial.rating}/5)`
}
