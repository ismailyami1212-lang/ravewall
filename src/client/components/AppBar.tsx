import { Link, useNavigate } from 'react-router-dom'
import { useSession } from '../session'
import { Button, Logo } from './Primitives'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

/** Shared top bar for the signed-in area. */
export function AppBar() {
  const { business, signOut } = useSession()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <header className="appbar">
      <div className="container appbar-inner">
        <Link to="/dashboard" className="appbar-brand" aria-label="RaveWall home">
          <Logo />
        </Link>
        <nav className="appbar-nav" aria-label="Primary">
          <Link to="/dashboard">Inbox</Link>
          <Link to="/clients">Clients</Link>
          <Link to="/widgets">Widgets</Link>
          <Link to="/team">Team</Link>
          <Link to="/analytics">Analytics</Link>
          <Link to="/account">Account</Link>
        </nav>
        <div className="appbar-right">
          <WorkspaceSwitcher />
          {business ? (
            <span className="appbar-business" title={business.slug}>
              <span className="dot" style={{ background: business.accentColor }} aria-hidden="true" />
              {business.name}
            </span>
          ) : null}
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  )
}
