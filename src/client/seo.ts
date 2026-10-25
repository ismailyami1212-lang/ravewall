/**
 * Route-aware SEO metadata for the RaveWall SPA.
 *
 * The app ships one static HTML shell. Public routes apply their own title,
 * description, canonical and social tags once React mounts, and
 * `resetMetadata()` restores the site-wide defaults whenever a route unmounts.
 *
 * The defaults are defined here rather than snapshotted from the DOM: a wall
 * request now arrives with server-injected wall metadata, so a DOM snapshot
 * would incorrectly treat that wall as the baseline and leak its title and
 * social tags onto the landing page after client-side navigation.
 *
 * Structured data is generated only from real approved testimonials — never
 * invented values — and aggregateRating is omitted when there is nothing to
 * aggregate.
 */
import type { Business, WallTestimonial } from './api'

const SITE_NAME = 'RaveWall'
const PRODUCTION_ORIGIN = 'https://ravewall.vercel.app'
const OG_IMAGE_PATH = '/og-image.png'
const DEFAULT_IMAGE_ALT = 'RaveWall — testimonials for every client, one workspace'
const DEFAULT_TITLE = 'RaveWall — testimonials for every client, one workspace'
const DEFAULT_DESCRIPTION =
  'RaveWall helps agencies and freelancers collect, manage and publish customer testimonials across every client — one workspace, saved widgets and team access.'
const DEFAULT_SOCIAL_DESCRIPTION =
  'Collect, manage and publish customer testimonials across all your clients from one clean workspace. Free during Early Access, no credit card.'

type TagKind = 'canonical' | 'name' | 'property'

interface ManagedTag {
  selector: string
  kind: TagKind
  key: string
}

const TAG = {
  description: { selector: 'meta[name="description"]', kind: 'name', key: 'description' },
  robots: { selector: 'meta[name="robots"]', kind: 'name', key: 'robots' },
  canonical: { selector: 'link[rel="canonical"]', kind: 'canonical', key: 'canonical' },
  ogTitle: { selector: 'meta[property="og:title"]', kind: 'property', key: 'og:title' },
  ogDescription: {
    selector: 'meta[property="og:description"]',
    kind: 'property',
    key: 'og:description',
  },
  ogUrl: { selector: 'meta[property="og:url"]', kind: 'property', key: 'og:url' },
  ogType: { selector: 'meta[property="og:type"]', kind: 'property', key: 'og:type' },
  ogSiteName: {
    selector: 'meta[property="og:site_name"]',
    kind: 'property',
    key: 'og:site_name',
  },
  ogImage: { selector: 'meta[property="og:image"]', kind: 'property', key: 'og:image' },
  ogImageWidth: {
    selector: 'meta[property="og:image:width"]',
    kind: 'property',
    key: 'og:image:width',
  },
  ogImageHeight: {
    selector: 'meta[property="og:image:height"]',
    kind: 'property',
    key: 'og:image:height',
  },
  ogImageAlt: {
    selector: 'meta[property="og:image:alt"]',
    kind: 'property',
    key: 'og:image:alt',
  },
  ogLocale: { selector: 'meta[property="og:locale"]', kind: 'property', key: 'og:locale' },
  twitterCard: { selector: 'meta[name="twitter:card"]', kind: 'name', key: 'twitter:card' },
  twitterTitle: { selector: 'meta[name="twitter:title"]', kind: 'name', key: 'twitter:title' },
  twitterDescription: {
    selector: 'meta[name="twitter:description"]',
    kind: 'name',
    key: 'twitter:description',
  },
  twitterImage: { selector: 'meta[name="twitter:image"]', kind: 'name', key: 'twitter:image' },
  twitterImageAlt: {
    selector: 'meta[name="twitter:image:alt"]',
    kind: 'name',
    key: 'twitter:image:alt',
  },
  twitterSite: { selector: 'meta[name="twitter:site"]', kind: 'name', key: 'twitter:site' },
} satisfies Record<string, ManagedTag>

function siteOrigin(): string {
  if (typeof window === 'undefined') return PRODUCTION_ORIGIN
  return window.location.origin || PRODUCTION_ORIGIN
}

function identifyingAttributes(tag: ManagedTag): Record<string, string> {
  if (tag.kind === 'canonical') return { rel: 'canonical' }
  if (tag.kind === 'name') return { name: tag.key }
  return { property: tag.key }
}

function createTag(tag: ManagedTag, attributes: Record<string, string>): HTMLElement {
  const node = document.createElement(tag.kind === 'canonical' ? 'link' : 'meta')
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value)
  }
  return node
}

function removeTag(selector: string): void {
  document.head.querySelectorAll(selector).forEach((node) => node.remove())
}

function setTag(tag: ManagedTag, value: string): void {
  removeTag(tag.selector)
  const attributes = identifyingAttributes(tag)
  if (tag.kind === 'canonical') attributes.href = value
  else attributes.content = value
  attributes['data-seo-dynamic'] = 'true'
  document.head.appendChild(createTag(tag, attributes))
}

function removeJsonLd(): void {
  document.head
    .querySelectorAll('script[data-seo-jsonld="true"]')
    .forEach((node) => node.remove())
}

/**
 * Restores the site-wide metadata defaults and removes every dynamic tag and
 * JSON-LD block. Every page-level helper returns this as its effect cleanup, so
 * client-side navigation cannot leave another route's metadata behind.
 */
export function resetMetadata(): void {
  if (typeof document === 'undefined') return

  const origin = siteOrigin()
  const image = `${origin}${OG_IMAGE_PATH}`

  document.title = DEFAULT_TITLE
  setTag(TAG.description, DEFAULT_DESCRIPTION)
  setTag(TAG.canonical, `${origin}/`)
  removeTag(TAG.robots.selector)

  setTag(TAG.ogTitle, DEFAULT_TITLE)
  setTag(TAG.ogDescription, DEFAULT_SOCIAL_DESCRIPTION)
  setTag(TAG.ogUrl, `${origin}/`)
  setTag(TAG.ogType, 'website')
  setTag(TAG.ogSiteName, SITE_NAME)
  setTag(TAG.ogImage, image)
  setTag(TAG.ogImageWidth, '1200')
  setTag(TAG.ogImageHeight, '630')
  setTag(TAG.ogImageAlt, DEFAULT_IMAGE_ALT)
  setTag(TAG.ogLocale, 'en_US')

  setTag(TAG.twitterCard, 'summary_large_image')
  setTag(TAG.twitterTitle, DEFAULT_TITLE)
  setTag(TAG.twitterDescription, DEFAULT_SOCIAL_DESCRIPTION)
  setTag(TAG.twitterImage, image)
  setTag(TAG.twitterImageAlt, DEFAULT_IMAGE_ALT)
  setTag(TAG.twitterSite, '@ravewall')

  removeJsonLd()
}

export interface PageMetadata {
  title: string
  description: string
  /** Route path, e.g. `/pricing`. Resolved against the current origin. */
  path: string
  type?: string
  image?: string
  imageAlt?: string
  imageWidth?: string | null
  imageHeight?: string | null
  /** Optional robots directive. `null` removes any inherited directive. */
  robots?: string | null
  jsonLd?: Record<string, unknown>
}

/**
 * Applies a complete, route-specific metadata set and returns a cleanup that
 * restores the site defaults. The standard description is updated alongside the
 * social tags so search engines and unfurlers see the same copy.
 */
export function applyPageMetadata(metadata: PageMetadata): () => void {
  if (typeof document === 'undefined') return () => undefined

  // Start from the defaults so no tag from the previous route survives.
  resetMetadata()

  const origin = siteOrigin()
  const path = metadata.path.startsWith('/') ? metadata.path : `/${metadata.path}`
  const url = `${origin}${path}`
  const customImage = Boolean(metadata.image)
  const image = metadata.image ?? `${origin}${OG_IMAGE_PATH}`
  const imageAlt = metadata.imageAlt ?? DEFAULT_IMAGE_ALT
  const imageWidth = metadata.imageWidth ?? (customImage ? null : '1200')
  const imageHeight = metadata.imageHeight ?? (customImage ? null : '630')

  document.title = metadata.title

  setTag(TAG.description, metadata.description)
  setTag(TAG.canonical, url)
  if (metadata.robots) setTag(TAG.robots, metadata.robots)
  else removeTag(TAG.robots.selector)

  setTag(TAG.ogTitle, metadata.title)
  setTag(TAG.ogDescription, metadata.description)
  setTag(TAG.ogUrl, url)
  setTag(TAG.ogType, metadata.type ?? 'website')
  setTag(TAG.ogSiteName, SITE_NAME)
  setTag(TAG.ogImage, image)
  if (imageWidth && imageHeight) {
    setTag(TAG.ogImageWidth, imageWidth)
    setTag(TAG.ogImageHeight, imageHeight)
  } else {
    removeTag(TAG.ogImageWidth.selector)
    removeTag(TAG.ogImageHeight.selector)
  }
  setTag(TAG.ogImageAlt, imageAlt)
  setTag(TAG.ogLocale, 'en_US')

  setTag(TAG.twitterCard, 'summary_large_image')
  setTag(TAG.twitterTitle, metadata.title)
  setTag(TAG.twitterDescription, metadata.description)
  setTag(TAG.twitterImage, image)
  setTag(TAG.twitterImageAlt, imageAlt)
  setTag(TAG.twitterSite, '@ravewall')

  if (metadata.jsonLd) {
    const jsonLd = document.createElement('script')
    jsonLd.type = 'application/ld+json'
    jsonLd.setAttribute('data-seo-jsonld', 'true')
    jsonLd.textContent = JSON.stringify(metadata.jsonLd)
    document.head.appendChild(jsonLd)
  }

  return resetMetadata
}

/** JSON-LD for a wall: Organization + real reviews, aggregate only when real. */
export function buildWallJsonLd(
  business: Business,
  testimonials: WallTestimonial[],
  stats: { count: number; averageRating: number },
  origin = siteOrigin(),
  slug = business.slug,
): Record<string, unknown> {
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: business.name,
    url: `${origin}/wall/${slug}`,
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

/** Applies wall-specific metadata; returns a cleanup that restores defaults. */
export function applyWallMetadata(
  business: Business,
  testimonials: WallTestimonial[],
  stats: { count: number; averageRating: number },
  slug = business.slug,
): () => void {
  const wallSlug = slug || business.slug
  const logo = (business.logoUrl ?? '').trim()
  const title = `${business.name} — customer testimonials`
  const tagline = (business.tagline ?? '').trim()
  const taglineWithStop = /[.!?]$/.test(tagline) ? tagline : `${tagline}.`
  const description = tagline
    ? `${taglineWithStop} Read what ${business.name}'s customers say.`
    : stats.count > 0
      ? `Read what ${business.name}'s customers say — ${stats.count} testimonial${
          stats.count === 1 ? '' : 's'
        } on RaveWall.`
      : `Read what ${business.name}'s customers say on RaveWall.`

  return applyPageMetadata({
    title,
    description,
    path: `/wall/${wallSlug}`,
    type: 'website',
    image: /^https?:\/\//i.test(logo) ? logo : undefined,
    imageAlt: `${business.name} — customer testimonials on RaveWall`,
    robots: stats.count > 0 ? null : 'noindex, follow',
    jsonLd: buildWallJsonLd(business, testimonials, stats, siteOrigin(), wallSlug),
  })
}

/** Applies the same noindex metadata as the server-rendered missing-wall page. */
export function applyWallNotFoundMetadata(): () => void {
  const path = typeof window === 'undefined' ? '/wall' : window.location.pathname
  return applyPageMetadata({
    title: 'Wall not found — RaveWall',
    description:
      'The testimonial wall you are looking for does not exist. Browse RaveWall to collect, moderate and publish customer testimonials.',
    path,
    robots: 'noindex, follow',
  })
}

/**
 * The plans exposed on `/pricing`. Prices are the planned subscription prices
 * shown in the UI; RaveWall itself is free during Early Access.
 */
const PRICING_OFFERS = [
  {
    '@type': 'Offer',
    name: 'Free',
    price: '0',
    priceCurrency: 'USD',
    description:
      'One client with a collection link, public wall, moderation inbox and all four widget layouts.',
  },
  {
    '@type': 'Offer',
    name: 'Starter — monthly',
    price: '5',
    priceCurrency: 'USD',
    description: 'Up to 3 clients, projects, CSV import/export and analytics. Billed monthly.',
  },
  {
    '@type': 'Offer',
    name: 'Starter — yearly',
    price: '50',
    priceCurrency: 'USD',
    description: 'Up to 3 clients, projects, CSV import/export and analytics. Billed yearly.',
  },
  {
    '@type': 'Offer',
    name: 'Pro — monthly',
    price: '9',
    priceCurrency: 'USD',
    description:
      'Up to 10 clients, custom questions, tags and saved widgets with rating and tag filters. Billed monthly.',
  },
  {
    '@type': 'Offer',
    name: 'Pro — yearly',
    price: '90',
    priceCurrency: 'USD',
    description:
      'Up to 10 clients, custom questions, tags and saved widgets with rating and tag filters. Billed yearly.',
  },
  {
    '@type': 'Offer',
    name: 'Agency — monthly',
    price: '29',
    priceCurrency: 'USD',
    description:
      'Unlimited clients, team roles, client-scoped access and per-client analytics. Billed monthly.',
  },
  {
    '@type': 'Offer',
    name: 'Agency — yearly',
    price: '290',
    priceCurrency: 'USD',
    description:
      'Unlimited clients, team roles, client-scoped access and per-client analytics. Billed yearly.',
  },
]

/** Explicit metadata and Offer schema for `/pricing`. */
export function applyPricingMetadata(): () => void {
  const origin = siteOrigin()
  return applyPageMetadata({
    title: 'RaveWall Pricing — free during Early Access',
    description:
      'Simple testimonial software pricing. Free during Early Access, no credit card. Starter $5/month, Pro $9/month, Agency coming soon.',
    path: '/pricing',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'RaveWall',
      url: `${origin}/pricing`,
      description:
        'RaveWall collects, moderates and publishes customer testimonials across every client from one workspace.',
      brand: { '@type': 'Brand', name: 'RaveWall' },
      offers: PRICING_OFFERS,
    },
  })
}

/** Explicit metadata for `/privacy`. */
export function applyPrivacyMetadata(): () => void {
  return applyPageMetadata({
    title: 'Privacy policy — RaveWall',
    description:
      'How RaveWall collects, uses and protects account, testimonial and technical information.',
    path: '/privacy',
  })
}

/** Explicit metadata for `/terms`. */
export function applyTermsMetadata(): () => void {
  return applyPageMetadata({
    title: 'Terms of service — RaveWall',
    description:
      'The terms that govern your use of RaveWall’s testimonial collection, moderation and publishing service.',
    path: '/terms',
  })
}

export { DEFAULT_TITLE, SITE_NAME }
