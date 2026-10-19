import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  api,
  getActiveWorkspaceId,
  restoreActiveWorkspaceId,
  setActiveWorkspaceId,
  type Business,
  type Membership,
  type Role,
  type SessionUser,
  type Workspace,
} from './api'

// Restore the previously selected workspace before the first /me call so the
// request is already scoped correctly.
restoreActiveWorkspaceId()

type SessionValue = {
  user: SessionUser | null
  business: Business | null
  loading: boolean
  refresh: () => Promise<void>
  setBusiness: (business: Business | null) => void
  signOut: () => Promise<void>

  /** Active workspace id — drives the x-workspace-id header on every request. */
  workspaceId: string | null
  workspace: Workspace | null
  role: Role | null
  memberships: Membership[]
  setWorkspaceId: (id: string | null) => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])

  const refresh = useCallback(async () => {
    try {
      const me = await api.me()
      setUser(me.user)
      setBusiness(me.business)
      setMemberships(me.memberships ?? [])

      // Resolve the active workspace: honour a saved choice when it is still
      // valid, otherwise fall back to the account's primary workspace.
      const saved = getActiveWorkspaceId() ?? (me.workspace?.id ?? null)
      const active =
        saved && (me.memberships ?? []).some((m) => m.workspaceId === saved)
          ? saved
          : me.workspace?.id ?? me.memberships?.[0]?.workspaceId ?? null
      setActiveWorkspaceId(active)
      setWorkspaceIdState(active)
      const activeMembership = (me.memberships ?? []).find((m) => m.workspaceId === active) ?? null
      setWorkspace(
        activeMembership
          ? { id: activeMembership.workspaceId, name: activeMembership.workspaceName, plan: activeMembership.plan }
          : (me.workspace ?? null),
      )
      setRole(activeMembership?.role ?? me.role ?? null)
    } catch {
      setUser(null)
      setBusiness(null)
      setMemberships([])
      setWorkspace(null)
      setRole(null)
      setWorkspaceIdState(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
      setBusiness(null)
      setMemberships([])
      setWorkspace(null)
      setRole(null)
      setWorkspaceIdState(null)
      setActiveWorkspaceId(null)
    }
  }, [])

  const setWorkspaceId = useCallback(
    async (id: string | null) => {
      setActiveWorkspaceId(id)
      setWorkspaceIdState(id)
      // Refresh so business/role reflect the newly scoped workspace.
      await refresh()
    },
    [refresh],
  )

  const value = useMemo<SessionValue>(
    () => ({
      user,
      business,
      loading,
      refresh,
      setBusiness,
      signOut,
      workspaceId,
      workspace,
      role,
      memberships,
      setWorkspaceId,
    }),
    [user, business, loading, refresh, signOut, workspaceId, workspace, role, memberships, setWorkspaceId],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside a SessionProvider')
  return value
}
