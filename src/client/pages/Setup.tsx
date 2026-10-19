import { Navigate, useNavigate } from 'react-router-dom'
import { AppBar } from '../components/AppBar'
import { BusinessForm } from '../components/BusinessForm'
import { useSession } from '../session'

/** First-run business setup. Existing workspaces are sent to the dashboard. */
export function Setup() {
  const { business, user } = useSession()
  const navigate = useNavigate()

  if (business) return <Navigate to="/dashboard" replace />

  return (
    <div className="app-shell">
      <AppBar />
      <main className="container narrow">
        <div className="page-head">
          <span className="pill">Step 2 of 2</span>
          <h1>Set up your business</h1>
          <p>
            {user ? `Almost there, ${user.name}. ` : ''}
            This is what your customers will see when they open your testimonial link.
          </p>
        </div>
        <div className="card card-pad">
          <BusinessForm mode="create" onSaved={() => navigate('/dashboard', { replace: true })} />
        </div>
      </main>
    </div>
  )
}
