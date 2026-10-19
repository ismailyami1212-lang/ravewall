import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Logo } from './Primitives'

/** Two-panel layout shared by the sign-in and sign-up screens. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <Link to="/" className="appbar-brand">
          <Logo />
        </Link>
        <div className="auth-aside-body">
          <h2>Collect. Moderate. Publish.</h2>
          <p>
            A unique collection link, a moderation inbox and a public wall — with per-row access
            rules so nothing leaks between workspaces.
          </p>
          <ul className="check-list">
            <li>1–5 star ratings</li>
            <li>Approve, reject, delete</li>
            <li>Copy any testimonial in one click</li>
          </ul>
        </div>
        <p className="auth-aside-foot">RaveWall · testimonial platform</p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="auth-sub">{subtitle}</p>
          {children}
          <div className="auth-footer">{footer}</div>
        </div>
      </main>
    </div>
  )
}
