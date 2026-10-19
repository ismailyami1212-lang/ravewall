/**
 * Wall-page SEO metadata.
 *
 * The SPA ships one static HTML shell, so per-wall metadata is injected
 * client-side once the wall data loads. Search and social crawlers that execute
 * JavaScript (Google, Bing, most card unfurlers) see the injected tags; the
 * static fallback in index.html remains the generic RaveWall description.
 *
 * Structured data is generated only from real approved testimonials — never
 * invented values — and aggregateRating is omitted when there is nothing to
 * aggregate.
 */
import type { Business, WallTestimonial } from './api'

const SITE_NAME = 'RaveWall'
const PRODUCTION_ORIGIN = 'https://ravewall.vercel.app'

function siteOrigin(): string {
  if (typeof window === 'undefined') return PRODUCTION_ORIGIN
  return window.location.origin || PRODUCTION_ORIGIN
}

function upsertMeta(selector: string, create: () => HTMLElement): void {
  const existing = document.head.querySelector(selector)
  if (existing) {
    existing.remove()
  }
  const node = create()
  document.head.appendChild(node)
}

function metaProperty(property: string, content: string): HTMLElement {
  const node = document.createElement('meta')
  node.setAttribute('property', property)
  node.setAttribute('content', content)
  return node
}

function metaName(name: string, content: string): HTMLElement {
  const node = document.createElement('meta')
  node.setAttribute('name', name)
  node.setAttribute('content', content)
  return node
}

function canonicalLink(href: string): HTMLElement {
  const node = document.createElement('link')
  node.setAttribute('rel', 'canonical')
  node.setAttribute('href', href)
  return node
}

/** JSON-LD for a wall: Organization + real reviews, aggregate only when real. */
export function buildWallJsonLd(
  business: Business,
  testimonials: WallTestimonial[],
  stats: { count: number; averageRating: number },
  origin = siteOrigin(),
): Record<string, unknown> {
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: business.name,
    url: `${origin}/wall/${business.slug}`,
  }
  if (business.tagline) node.description = business.tagline

  if (stats.count > 0 && stats.averageRating > 0) {
    node.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: stats.averageRating,
      reviewCount: stats.count,
      bestRating: 5,
      worstRating: 1,
    }
  }

  node.review = testimonials.map((testimonial) => ({
    '@type': 'Review',
    author: { '@type': 'Person', name: testimonial.name },
    reviewRating: {
      '@type': 'Rating',
      ratingValue: testimonial.rating,
      bestRating: 5,
      worstRating: 1,
    },
    reviewBody: testimonial.text,
    datePublished: testimonial.createdAt,
  }))

  return node
}

const DEFAULT_TITLE = 'RaveWall — collect customer stories worth sharing'

/** Applies wall-specific metadata; returns a cleanup that restores defaults. */
export function applyWallMetadata(
  business: Business,
  testimonials: WallTestimonial[],
  stats: { count: number; averageRating: number },
): () => void {
  if (typeof document === 'undefined') return () => undefined
  const origin = siteOrigin()
  const url = `${origin}/wall/${business.slug}`
  const title = `${business.name} — customer testimonials`
  const description = business.tagline
    ? `${business.tagline} Read what ${business.name}'s customers say.`
    : `Read what ${business.name}'s customers say — ${stats.count} testimonial${stats.count === 1 ? '' : 's'} on RaveWall.`

  const previousTitle = document.title
  document.title = title

  upsertMeta('link[rel="canonical"]', () => canonicalLink(url))
  upsertMeta('meta[property="og:title"]', () => metaProperty('og:title', title))
  upsertMeta('meta[property="og:description"]', () => metaProperty('og:description', description))
  upsertMeta('meta[property="og:url"]', () => metaProperty('og:url', url))
  upsertMeta('meta[property="og:site_name"]', () => metaProperty('og:site_name', SITE_NAME))
  upsertMeta('meta[property="og:type"]', () => metaProperty('og:type', 'website'))
  upsertMeta('meta[name="twitter:title"]', () => metaName('twitter:title', title))
  upsertMeta('meta[name="twitter:description"]', () => metaName('twitter:description', description))

  const jsonLd = document.createElement('script')
  jsonLd.type = 'application/ld+json'
  jsonLd.textContent = JSON.stringify(buildWallJsonLd(business, testimonials, stats, origin))
  document.head.appendChild(jsonLd)

  return () => {
    document.title = previousTitle
    jsonLd.remove()
    upsertMeta('link[rel="canonical"]', () => canonicalLink(origin + '/'))
  }
}

export { DEFAULT_TITLE, SITE_NAME }
