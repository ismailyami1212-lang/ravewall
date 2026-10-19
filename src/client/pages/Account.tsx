import { useCallback, useEffect, useState } from 'react'
import { AppBar } from '../components/AppBar'
import { Button, Card, Field, Input, Spinner } from '../components/Primitives'
import { useToast } from '../components/Toast'
import { useSession } from '../session'
import { accountApi } from '../api'

type Session = { id: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean }

export function Account() {
  const { notify } = useToast()
  const { refresh } = useSession()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwError, setPwError] = useState('')

  const [sessions, setSessions] = useState<Session[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [busySession, setBusySession] = useState<string | null>(null)

  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    try {
      const me = await accountApi.get()
      setName(me.user.name)
      setEmail(me.user.email)
      const s = await accountApi.sessions()
      setSessions(s.items)
    } catch {
      notify('Could not load account.', 'error')
    } finally {
      setLoadingSessions(false)
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    try {
      await accountApi.update({ name, email })
      notify('Profile updated.', 'success')
      await refresh()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update profile.', 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setSavingPw(true)
    setPwError('')
    try {
      const res = await accountApi.changePassword({ currentPassword: cur, newPassword: next })
      notify(`Password changed. ${res.otherSessionsEnded} other session(s) ended.`, 'success')
      setCur('')
      setNext('')
      await load()
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Could not change password.')
    } finally {
      setSavingPw(false)
    }
  }

  async function revoke(id: string) {
    setBusySession(id)
    try {
      await accountApi.revokeSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not revoke session.', 'error')
    } finally {
      setBusySession(null)
    }
  }

  async function revokeOthers() {
    setBusySession('all')
    try {
      const res = await accountApi.revokeOtherSessions()
      notify(`${res.ended} other session(s) ended.`, 'success')
      await load()
    } finally {
      setBusySession(null)
    }
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault()
    if (!window.confirm('Delete your account and all of its data? This cannot be undone.')) return
    setDeleting(true)
    setDeleteError('')
    try {
      await accountApi.deleteAccount(deletePassword)
      notify('Account deleted.', 'success')
      await refresh()
      window.location.href = '/'
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete account.')
      setDeleting(false)
    }
  }

  return (
    <div className="app-shell">
      <AppBar />
      <main className="container narrow">
        <div className="page-head">
          <h1>Account</h1>
          <p>Manage your profile, password and active sessions.</p>
        </div>

        <Card className="card-pad" style={{ marginBottom: 24 }}>
          <h3 className="section-title">Profile</h3>
          <form onSubmit={saveProfile} className="form-grid">
            <Field label="Name" htmlFor="ac-name">
              <Input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Email" htmlFor="ac-email">
              <Input id="ac-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <div className="form-actions">
              <Button type="submit" loading={savingProfile}>Save profile</Button>
            </div>
          </form>
        </Card>

        <Card className="card-pad" style={{ marginBottom: 24 }}>
          <h3 className="section-title">Password</h3>
          <form onSubmit={changePassword} className="form-grid">
            <Field label="Current password" htmlFor="ac-cur" error={pwError || undefined}>
              <Input id="ac-cur" type="password" value={cur} onChange={(e) => setCur(e.target.value)} required />
            </Field>
            <Field label="New password" htmlFor="ac-next">
              <Input id="ac-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
            </Field>
            <div className="form-actions">
              <Button type="submit" loading={savingPw}>Change password</Button>
            </div>
          </form>
        </Card>

        <Card className="card-pad" style={{ marginBottom: 24 }}>
          <div className="section-title-row">
            <h3 className="section-title">Sessions</h3>
            <Button variant="ghost" size="sm" onClick={revokeOthers} disabled={sessions.filter((s) => !s.current).length === 0}>
              End all others
            </Button>
          </div>
          {loadingSessions ? (
            <div className="list-loading"><Spinner label="Loading sessions" /></div>
          ) : (
            <ul className="item-list">
              {sessions.map((s) => (
                <li key={s.id} className="item-row">
                  <div>
                    <strong>{s.current ? 'This device' : 'Signed in device'}</strong>
                    <span className="muted"> · last seen {new Date(s.lastSeenAt).toLocaleString()}</span>
                  </div>
                  {s.current ? (
                    <span className="badge badge-approved">current</span>
                  ) : (
                    <Button variant="ghost" size="sm" loading={busySession === s.id} onClick={() => revoke(s.id)}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="card-pad danger-zone">
          <h3 className="section-title">Delete account</h3>
          <p className="muted">Permanently removes your account. You will be asked to confirm with your password.</p>
          <form onSubmit={deleteAccount} className="inline-form">
            <Input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Your password to confirm"
              aria-label="Password to confirm deletion"
              required
            />
            <Button variant="danger" loading={deleting} disabled={!deletePassword}>
              Delete account
            </Button>
          </form>
          {deleteError ? <p className="field-error">{deleteError}</p> : null}
        </Card>
      </main>
    </div>
  )
}
