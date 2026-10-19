import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Logo } from './Primitives'

const SECTIONS = [
  { label: 'Product', hash: 'product' },
  { label: 'Widgets', hash: 'widgets' },
  { label: 'Examples', hash: 'examples' },
  { label: 'How it works', hash: 'how' },
]

/**
 * Marketing top bar, shared by the landing and pricing pages.
 *
 * On the landing page the section links are in-page anchors; on other pages
 * they point back to the landing page's anchors.
 */
export function MarketingNav({ home = false }: { home?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const href = (hash: string) => (home ? `#${hash}` : `/#${hash}`)

  // A route change must never leave the mobile panel open.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Escape closes the panel for keyboard users.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  return (
    <header className="mkt-nav">
      <div className="mkt-wrap mkt-nav-inner">
        <Link to="/" className="mkt-brand" aria-label="RaveWall home">
          <Logo />
        </Link>

        <nav className="mkt-links" aria-label="Sections">
          {SECTIONS.map((section) => (
            <a key={section.hash} href={href(section.hash)}>
              {section.label}
            </a>
          ))}
          <Link to="/pricing">Pricing</Link>
        </nav>

        <div className="mkt-nav-actions">
          <Link
            to="/login"
            className="mkt-btn mkt-btn-sm"
            style={{ background: 'transparent', color: 'var(--mkt-ink-soft)' }}
          >
            Log in
          </Link>
          <Link to="/signup" className="mkt-btn mkt-btn-primary mkt-btn-sm">
            Start free
          </Link>
          <button
            type="button"
            className="mkt-menu-btn"
            aria-expanded={menuOpen}
            aria-controls="mkt-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="mkt-wrap mkt-menu-panel mkt-menu-open" id="mkt-menu">
          {SECTIONS.map((section) => (
            <a key={section.hash} href={href(section.hash)} onClick={() => setMenuOpen(false)}>
              {section.label}
            </a>
          ))}
          <Link to="/pricing" onClick={() => setMenuOpen(false)}>
            Pricing
          </Link>
          <Link to="/login" onClick={() => setMenuOpen(false)}>
            Log in
          </Link>
          <Link to="/signup" className="mkt-btn mkt-btn-primary" onClick={() => setMenuOpen(false)}>
            Start free
          </Link>
        </div>
      ) : null}
    </header>
  )
}
