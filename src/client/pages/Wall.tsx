import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Business, type WallTestimonial } from '../api'
import { Button, EmptyState, Spinner } from '../components/Primitives'
import { Stars } from '../components/Stars'
import { formatDate, initials } from '../format'
import { applyWallMetadata, applyWallNotFoundMetadata } from '../seo'
import { Brand } from './Collect'

/** Public wall reached through /wall/:slug — approved testimonials only. */
export function Wall() {
  const { slug = '' } = useParams()

  const [business, setBusiness] = useState<Business | null>(null)
  const [testimonials, setTestimonials] = useState<WallTestimonial[]>([])
  const [stats, setStats] = useState({ count: 0, averageRating: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [minRating, setMinRating] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .wall(slug)
      .then((result) => {
        if (cancelled) return
        setBusiness(result.business)
        setTestimonials(result.testimonials)
        setStats(result.stats)
      })
      .catch((wallError) => {
        if (!cancelled) {
          setError(wallError instanceof Error ? wallError.message : 'Could not load this wall.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const visible = useMemo(
    () => (minRating === 0 ? testimonials : testimonials.filter((row) => row.rating >= minRating)),
    [testimonials, minRating],
  )

  // Wall-specific SEO metadata (title, canonical, social tags, JSON-LD) is
  // applied once the approved data loads and restored when the visitor leaves.
  // A missing wall still manages its noindex directive so client-side
  // navigation away from the 404 cannot leave `noindex` on another route.
  useEffect(() => {
    if (loading) return undefined
    if (!business) return applyWallNotFoundMetadata()
    return applyWallMetadata(business, testimonials, stats, slug)
  }, [business, testimonials, stats, loading, slug])

  if (loading) {
    return (
      <div className="center-screen">
        <Spinner label="Loading wall" />
      </div>
    )
  }

  if (error || !business) {
    return (
      <div className="center-screen">
        <div className="public-card public-error">
          <h1>Wall unavailable</h1>
          <p className="muted">{error || 'That testimonial wall does not exist.'}</p>
          <Link to="/" className="btn btn-outline">
            Go home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div
      className="public-shell"
      style={{ '--accent': business.accentColor } as React.CSSProperties}
    >
      <header className="wall-hero">
        <div className="wall-hero-inner">
          <Brand business={business} large />
          <h1 className="wall-title">What people say</h1>
          {business.tagline ? <p className="wall-tagline">{business.tagline}</p> : null}
          <div className="wall-summary">
            <Stars value={Math.round(stats.averageRating)} size="lg" />
            <span>
              <strong>{stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '—'}</strong> out of
              5 · {stats.count} testimonial{stats.count === 1 ? '' : 's'}
            </span>
          </div>
          <Link to={`/t/${business.slug}`} className="btn btn-primary">
            Leave a testimonial
          </Link>
        </div>
      </header>

      <main className="wall-main">
        {testimonials.length > 0 ? (
          <div className="wall-filter">
            <span className="muted">Filter by rating</span>
            <div className="wall-filter-buttons">
              <Button
                size="sm"
                variant={minRating === 0 ? 'primary' : 'outline'}
                onClick={() => setMinRating(0)}
              >
                All
              </Button>
              {[5, 4, 3].map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={minRating === value ? 'primary' : 'outline'}
                  onClick={() => setMinRating(value)}
                >
                  {value}★ &amp; up
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {visible.length === 0 ? (
          <EmptyState
            title={testimonials.length === 0 ? 'No testimonials yet' : 'Nothing matches that filter'}
            description={
              testimonials.length === 0
                ? 'Be the first to share what working with this business was like.'
                : 'Try a lower rating filter.'
            }
            action={
              testimonials.length === 0 ? (
                <Link to={`/t/${business.slug}`} className="btn btn-primary btn-sm">
                  Write a testimonial
                </Link>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setMinRating(0)}>
                  Show all
                </Button>
              )
            }
          />
        ) : (
          <div className="wall-grid">
            {visible.map((testimonial) => (
              <article className="wall-card" key={testimonial.id}>
                <Stars value={testimonial.rating} />
                <p className="wall-text">{testimonial.text}</p>
                <footer className="wall-meta">
                  <span className="avatar avatar-sm" aria-hidden="true">
                    {initials(testimonial.name)}
                  </span>
                  <div>
                    <strong>{testimonial.name}</strong>
                    <span className="muted">
                      {testimonial.company || formatDate(testimonial.createdAt)}
                    </span>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        )}
      </main>

      <footer className="public-footer">
        <span className="muted">Collected with RaveWall</span>
        <nav className="public-footer-links" aria-label="Legal">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  )
}
