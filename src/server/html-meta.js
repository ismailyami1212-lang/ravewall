/**
 * Minimal, dependency-free HTML metadata injection for server-rendered routes.
 *
 * The SPA shell is built once, but crawlers and social unfurlers do not all
 * execute JavaScript. Wall pages therefore get their title, description,
 * canonical, Open Graph and Twitter tags written into the HTML response before
 * it leaves the server. Everything interpolated here is user-controlled, so all
 * values are HTML-escaped and regex replacements use functions to keep `$` in a
 * business name from being interpreted as a replacement token.
 */

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const DEFAULT_IMAGE_ALT = 'RaveWall — testimonials for every client, one workspace'

/** Escape text for use in both HTML text nodes and quoted attributes. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replace the first match, or append the tag just before `</head>`. */
function replaceOrInsertTag(html, pattern, tag) {
  if (pattern.test(html)) return html.replace(pattern, () => tag)
  return html.replace('</head>', () => `  ${tag}\n  </head>`)
}

function setTitle(html, title) {
  return replaceOrInsertTag(html, /<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
}

function setMeta(html, attribute, key, content) {
  const pattern = new RegExp(`<meta\\s+${attribute}="${escapeRegExp(key)}"[^>]*>`, 'i')
  const tag = `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`
  return replaceOrInsertTag(html, pattern, tag)
}

function removeMeta(html, attribute, key) {
  const pattern = new RegExp(`\\s*<meta\\s+${attribute}="${escapeRegExp(key)}"[^>]*>`, 'gi')
  return html.replace(pattern, '')
}

function setCanonical(html, href) {
  const pattern = /<link\s+rel="canonical"[^>]*>/i
  const tag = `<link rel="canonical" href="${escapeHtml(href)}" />`
  return replaceOrInsertTag(html, pattern, tag)
}

function setImageDimensions(html, width, height) {
  if (width && height) {
    return setMeta(
      setMeta(html, 'property', 'og:image:width', width),
      'property',
      'og:image:height',
      height,
    )
  }
  return removeMeta(
    removeMeta(html, 'property', 'og:image:width'),
    'property',
    'og:image:height',
  )
}

/**
 * Apply the complete metadata set used by public HTML routes. The canonical and
 * social URL are passed separately so callers can choose a self-referencing URL
 * for project-specific walls without changing the visible route.
 */
export function injectHtmlMetadata(
  html,
  {
    title,
    description,
    canonicalUrl,
    socialUrl = canonicalUrl,
    image,
    imageAlt = DEFAULT_IMAGE_ALT,
    imageWidth = '1200',
    imageHeight = '630',
    robots = null,
  },
) {
  let output = html

  output = setTitle(output, title)
  output = setMeta(output, 'name', 'description', description)
  output = setCanonical(output, canonicalUrl)

  output = setMeta(output, 'property', 'og:title', title)
  output = setMeta(output, 'property', 'og:description', description)
  output = setMeta(output, 'property', 'og:url', socialUrl)
  output = setMeta(output, 'property', 'og:type', 'website')
  output = setMeta(output, 'property', 'og:image', image)
  output = setMeta(output, 'property', 'og:image:alt', imageAlt)
  output = setImageDimensions(output, imageWidth, imageHeight)

  output = setMeta(output, 'name', 'twitter:card', 'summary_large_image')
  output = setMeta(output, 'name', 'twitter:title', title)
  output = setMeta(output, 'name', 'twitter:description', description)
  output = setMeta(output, 'name', 'twitter:image', image)
  output = setMeta(output, 'name', 'twitter:image:alt', imageAlt)

  output = robots
    ? setMeta(output, 'name', 'robots', robots)
    : removeMeta(output, 'name', 'robots')

  return output
}

/**
 * Metadata for a real wall. A wall with no approved testimonials is still
 * readable, but it is thin content, so it gets `noindex, follow` and is also
 * excluded from the sitemap.
 */
export function injectWallMetadata(html, { business, stats, origin, slug }) {
  const name = String(business.name ?? '').trim() || 'This business'
  const tagline = String(business.tagline ?? '').trim()
  const taglineWithStop = tagline ? (/[.!?]$/.test(tagline) ? tagline : `${tagline}.`) : ''
  const count = Number(stats?.count ?? 0)
  const description = taglineWithStop
    ? `${taglineWithStop} Read what ${name}'s customers say.`
    : `Read what ${name}'s customers say${
        count > 0
          ? ` — ${count} testimonial${count === 1 ? '' : 's'} on RaveWall`
          : ' on RaveWall'
      }.`

  const logo = String(business.logoUrl ?? '').trim()
  const customImage = /^https?:\/\//i.test(logo)
  const wallSlug = String(slug || business.slug)
  const canonicalUrl = `${origin}/wall/${wallSlug}`

  return injectHtmlMetadata(html, {
    title: `${name} — customer testimonials`,
    description,
    canonicalUrl,
    socialUrl: canonicalUrl,
    image: customImage ? logo : `${origin}/og-image.png`,
    imageAlt: `${name} — customer testimonials on RaveWall`,
    // A customer logo has no known dimensions; do not declare a false 1200×630.
    imageWidth: customImage ? null : '1200',
    imageHeight: customImage ? null : '630',
    robots: count > 0 ? null : 'noindex, follow',
  })
}

/** Metadata for a missing or malformed wall URL. */
export function injectNotFoundMetadata(html, { origin, path }) {
  const title = 'Wall not found — RaveWall'
  const description =
    'The testimonial wall you are looking for does not exist. Browse RaveWall to collect, moderate and publish customer testimonials.'
  const canonicalUrl = `${origin}${path.startsWith('/') ? path : `/${path}`}`

  return injectHtmlMetadata(html, {
    title,
    description,
    canonicalUrl,
    socialUrl: canonicalUrl,
    image: `${origin}/og-image.png`,
    imageAlt: DEFAULT_IMAGE_ALT,
    robots: 'noindex, follow',
  })
}
