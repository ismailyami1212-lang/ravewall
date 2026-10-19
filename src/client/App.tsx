import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Spinner } from './components/Primitives'
import { useSession } from './session'
import { Collect } from './pages/Collect'
import { Dashboard } from './pages/Dashboard'
import { ForgotPassword } from './pages/ForgotPassword'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { Privacy, Terms } from './pages/Legal'
import { NotFound } from './pages/NotFound'
import { Pricing } from './pages/Pricing'
import { ResetPassword } from './pages/ResetPassword'
import { Settings } from './pages/Settings'
import { Setup } from './pages/Setup'
import { Signup } from './pages/Signup'
import { Wall } from './pages/Wall'
import { Widgets } from './pages/Widgets'
import { Clients } from './pages/Clients'
import { ClientDetail } from './pages/ClientDetail'
import { Team } from './pages/Team'
import { Analytics } from './pages/Analytics'
import { Account } from './pages/Account'

function FullPageSpinner() {
  return (
    <div className="center-screen">
      <Spinner label="Loading your workspace" />
    </div>
  )
}

/** Requires a signed-in user; sends visitors to the login page otherwise. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession()
  const location = useLocation()
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

/** Requires a completed business profile. */
function RequireBusiness({ children }: { children: ReactNode }) {
  const { business, loading } = useSession()
  if (loading) return <FullPageSpinner />
  if (!business) return <Navigate to="/setup" replace />
  return <>{children}</>
}

/** Keeps signed-in users away from the marketing/auth pages. */
function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { user, business, loading } = useSession()
  if (loading) return <FullPageSpinner />
  if (user) return <Navigate to={business ? '/dashboard' : '/setup'} replace />
  return <>{children}</>
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route
        path="/forgot-password"
        element={
          <RedirectIfSignedIn>
            <ForgotPassword />
          </RedirectIfSignedIn>
        }
      />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/login"
        element={
          <RedirectIfSignedIn>
            <Login />
          </RedirectIfSignedIn>
        }
      />
      <Route
        path="/signup"
        element={
          <RedirectIfSignedIn>
            <Signup />
          </RedirectIfSignedIn>
        }
      />
      <Route
        path="/setup"
        element={
          <RequireAuth>
            <Setup />
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <RequireBusiness>
              <Dashboard />
            </RequireBusiness>
          </RequireAuth>
        }
      />
      <Route
        path="/clients"
        element={
          <RequireAuth>
            <Clients />
          </RequireAuth>
        }
      />
      <Route
        path="/clients/:id"
        element={
          <RequireAuth>
            <ClientDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/team"
        element={
          <RequireAuth>
            <Team />
          </RequireAuth>
        }
      />
      <Route
        path="/analytics"
        element={
          <RequireAuth>
            <Analytics />
          </RequireAuth>
        }
      />
      <Route
        path="/account"
        element={
          <RequireAuth>
            <Account />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <RequireBusiness>
              <Settings />
            </RequireBusiness>
          </RequireAuth>
        }
      />
      <Route
        path="/widgets"
        element={
          <RequireAuth>
            <Widgets />
          </RequireAuth>
        }
      />
      <Route path="/t/:slug" element={<Collect />} />
      <Route path="/wall/:slug" element={<Wall />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
