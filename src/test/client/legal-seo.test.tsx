import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { Landing } from '../../client/pages/Landing'
import { Privacy, Terms } from '../../client/pages/Legal'
import { buildWallJsonLd } from '../../client/seo'
import type { Business, WallTestimonial } from '../../client/api'

afterEach(() => {
  document.title = ''
})

const BUSINESS: Business = {
  id: 'biz_1',
  name: 'Northwind Studio',
  slug: 'northwind',
  tagline: 'Design studio for ambitious teams',
  logoUrl: '',
  accentColor: '#0d9488',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const TESTIMONIALS: WallTestimonial[] = [
  {
    id: 't1',
    rating: 5,
    name: 'Priya Nair',
    company: 'Cobalt Labs',
    text: 'They reshaped our onboarding and it shows in the numbers.',
    createdAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: 't2',
    rating: 4,
    name: 'Sam Okafor',
    company: '',
    text: 'A calm, focused team that delivered on time.',
    createdAt: '2026-08-11T10:00:00.000Z',
  },
]

describe('legal pages', () => {
  it('renders the privacy policy with the RaveWall identity and a legal placeholder', () => {
    render(
      <MemoryRouter>
        <Privacy />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Privacy policy' })).toBeInTheDocument()
    expect(screen.getAllByText(/RaveWall/).length).toBeGreaterThan(0)
    expect(screen.getByText(/PLACEHOLDER/)).toBeInTheDocument()
    // The honest, non-legal-advice framing must be present.
    expect(screen.getByText(/Information we collect/i)).toBeInTheDocument()
  })

  it('renders the terms of service', () => {
    render(
      <MemoryRouter>
        <Terms />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Terms of service' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'The service' })).toBeInTheDocument()
  })

  it('links privacy and terms from the landing footer', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
  })
})

describe('wall structured data', () => {
  it('builds valid JSON-LD with real aggregate data only', () => {
    const jsonLd = buildWallJsonLd(BUSINESS, TESTIMONIALS, { count: 2, averageRating: 4.5 }, 'https://ravewall.vercel.app')
    const raw = JSON.stringify(jsonLd)
    expect(() => JSON.parse(raw)).not.toThrow()

    const parsed = JSON.parse(raw)
    expect(parsed['@type']).toBe('Organization')
    expect(parsed.name).toBe('Northwind Studio')
    expect(parsed.url).toBe('https://ravewall.vercel.app/wall/northwind')
    expect(parsed.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      reviewCount: 2,
      bestRating: 5,
      worstRating: 1,
    })
    expect(parsed.review).toHaveLength(2)
    const [first] = parsed.review
    expect(first['@type']).toBe('Review')
    expect(first.author).toEqual({ '@type': 'Person', name: 'Priya Nair' })
    expect(first.reviewRating.ratingValue).toBe(5)
    expect(first.reviewBody).toBe(TESTIMONIALS[0].text)
    expect(first.datePublished).toBe(TESTIMONIALS[0].createdAt)
  })

  it('omits the aggregate rating when there is nothing real to aggregate', () => {
    const jsonLd = buildWallJsonLd(BUSINESS, [], { count: 0, averageRating: 0 })
    expect(jsonLd.aggregateRating).toBeUndefined()
    expect(jsonLd.review).toEqual([])
  })

  it('never invents a business address, url or price', () => {
    const raw = JSON.stringify(buildWallJsonLd(BUSINESS, TESTIMONIALS, { count: 2, averageRating: 4.5 }))
    expect(raw).not.toContain('address')
    expect(raw).not.toContain('price')
    expect(raw).not.toContain('telephone')
  })
})
