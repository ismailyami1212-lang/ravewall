import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { Landing } from '../../client/pages/Landing'
import { Privacy, Terms } from '../../client/pages/Legal'
import {
  applyPricingMetadata,
  applyWallMetadata,
  applyWallNotFoundMetadata,
  buildWallJsonLd,
  resetMetadata,
} from '../../client/seo'
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

describe('route metadata', () => {
  afterEach(() => resetMetadata())

  it('writes standard and social descriptions for a wall, then restores defaults', () => {
    const origin = window.location.origin
    const restore = applyWallMetadata(BUSINESS, TESTIMONIALS, { count: 2, averageRating: 4.5 })

    const description =
      "Design studio for ambitious teams. Read what Northwind Studio's customers say."
    expect(document.title).toBe('Northwind Studio — customer testimonials')
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      description,
    )
    expect(document.querySelector('meta[property="og:description"]')?.getAttribute('content')).toBe(
      description,
    )
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
      `${origin}/og-image.png`,
    )
    expect(document.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe(
      '1200',
    )
    expect(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content')).toBe(
      `${origin}/og-image.png`,
    )
    expect(document.querySelector('script[data-seo-jsonld="true"]')).not.toBeNull()
    expect(document.querySelector('meta[name="robots"]')).toBeNull()

    restore()

    expect(document.title).toBe('RaveWall — testimonials for every client, one workspace')
    expect(
      document.querySelector('meta[name="description"]')?.getAttribute('content'),
    ).toContain('RaveWall helps agencies')
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${origin}/`)
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(
      'RaveWall — testimonials for every client, one workspace',
    )
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
      `${origin}/og-image.png`,
    )
    expect(document.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe(
      '1200',
    )
    expect(document.querySelector('script[data-seo-jsonld="true"]')).toBeNull()
  })

  it('marks a wall with no approved testimonials noindex and clears it on cleanup', () => {
    const restore = applyWallMetadata(BUSINESS, [], { count: 0, averageRating: 0 })

    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, follow',
    )
    expect(
      document.querySelector('meta[name="description"]')?.getAttribute('content'),
    ).toBe("Design studio for ambitious teams. Read what Northwind Studio's customers say.")

    restore()
    expect(document.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('marks a missing wall noindex and clears it on cleanup', () => {
    const restore = applyWallNotFoundMetadata()

    expect(document.title).toBe('Wall not found — RaveWall')
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, follow',
    )

    restore()
    expect(document.querySelector('meta[name="robots"]')).toBeNull()
    expect(document.title).toBe('RaveWall — testimonials for every client, one workspace')
  })

  it('applies explicit pricing metadata with an Offer array', () => {
    applyPricingMetadata()

    expect(document.title).toBe('RaveWall Pricing — free during Early Access')
    expect(
      document.querySelector('meta[name="description"]')?.getAttribute('content'),
    ).toContain('Starter $5/month')
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${window.location.origin}/pricing`,
    )
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(
      `${window.location.origin}/pricing`,
    )

    const script = document.querySelector('script[data-seo-jsonld="true"]')
    const jsonLd = JSON.parse(script?.textContent ?? '{}')
    expect(jsonLd['@type']).toBe('Product')
    expect(Array.isArray(jsonLd.offers)).toBe(true)
    expect(jsonLd.offers).toHaveLength(7)
    for (const offer of jsonLd.offers) {
      expect(offer['@type']).toBe('Offer')
      expect(offer.priceCurrency).toBe('USD')
    }
  })
})
