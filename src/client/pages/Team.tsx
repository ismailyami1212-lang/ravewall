import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppBar } from '../components/AppBar'
import { Button, Card, EmptyState, Field, Input, Spinner } from '../components/Primitives'
import { useToast } from '../components/Toast'
import { useSession } from '../session'
import { workspaceApi, type Role, type TeamMember } from '../api'

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  viewer: 'Viewer',
}

export function Team() {
  const { notify } = useToast()
  const { role, user } = useSession()

  const [members, setMembers] = useState<TeamMember[]>([])
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState<Role>('manager')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const canManage = role === 'owner' || role === 'admin'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await workspaceApi.listTeam()
      setMembers(res.items)
      setClients(res.clients)
    } catch {
      notify('Could not load the team.', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  async function addMember(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await workspaceApi.addMember({ email: email.trim(), role: newRole })
      notify(`${res.member.name ?? res.member.email} added as ${ROLE_LABELS[newRole]}.`, 'success')
      setEmail('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add member.')
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(member: TeamMember, next: Role) {
    try {
      await workspaceApi.updateMemberRole(member.userId, next)
      notify('Role updated.', 'success')
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update role.', 'error')
    }
  }

  async function remove(member: TeamMember) {
    try {
      await workspaceApi.removeMember(member.userId)
      notify('Member removed.', 'success')
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not remove member.', 'error')
    }
  }

  async function toggleClient(member: TeamMember, clientId: string) {
    const set = new Set(member.clientIds)
    if (set.has(clientId)) set.delete(clientId)
    else set.add(clientId)
    try {
      await workspaceApi.setMemberClients(member.userId, [...set])
      await load()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update access.', 'error')
    }
  }

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients])

  return (
    <div className="app-shell">
      <AppBar />
      <main className="container">
        <div className="page-head page-head-row">
          <div>
            <h1>Team</h1>
            <p>Owners and admins manage the workspace. Managers are limited to the clients you assign.</p>
          </div>
        </div>

        {canManage ? (
          <Card className="card-pad" style={{ marginBottom: 24 }}>
            <form onSubmit={addMember} className="inline-form">
              <Field label="Invite by email" htmlFor="tm-email" error={error || undefined} className="field-grow">
                <Input
                  id="tm-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  required
                />
              </Field>
              <Field label="Role" htmlFor="tm-role">
                <select className="input input-select" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} aria-label="Role">
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="viewer">Viewer</option>
                </select>
              </Field>
              <Button type="submit" loading={busy}>Add member</Button>
            </form>
            <p className="muted small">They need a free RaveWall account first — share your workspace name with them.</p>
          </Card>
        ) : null}

        {loading ? (
          <div className="list-loading"><Spinner label="Loading team" /></div>
        ) : members.length === 0 ? (
          <EmptyState title="No team members yet" description="Invite a teammate above to start collaborating." />
        ) : (
          <Card className="card-pad">
            <ul className="team-list">
              {members.map((m) => (
                <li key={m.id} className="team-row">
                  <div className="team-id">
                    <span className="avatar" aria-hidden="true">{(m.name ?? m.email ?? '?').slice(0, 1).toUpperCase()}</span>
                    <div>
                      <strong>{m.name ?? m.email}</strong>
                      <span className="muted">{m.email}</span>
                    </div>
                  </div>

                  <div className="team-role">
                    {canManage ? (
                      <select
                        className="input input-select"
                        value={m.role}
                        disabled={m.userId === user?.id}
                        onChange={(e) => changeRole(m, e.target.value as Role)}
                        aria-label={`Role for ${m.email}`}
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="manager">Manager</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <span className="role-pill">{ROLE_LABELS[m.role]}</span>
                    )}
                  </div>

                  <div className="team-clients">
                    {m.role === 'manager' || m.role === 'viewer' ? (
                      <div className="client-chips">
                        {clients.map((c) => (
                          <button
                            type="button"
                            key={c.id}
                            className={`chip ${m.clientIds.includes(c.id) ? 'chip-on' : ''}`.trim()}
                            onClick={() => canManage && toggleClient(m, c.id)}
                            disabled={!canManage}
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">All clients</span>
                    )}
                  </div>

                  <div className="team-actions">
                    {canManage && m.userId !== user?.id ? (
                      <Button variant="ghost" size="sm" onClick={() => remove(m)}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </main>
    </div>
  )
}
