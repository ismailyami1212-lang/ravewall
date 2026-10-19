import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

/**
 * Brand-safety guards for the RaveWall migration. The visible product name is
 * locked to "RaveWall"; old names must not reappear. Technical identifiers
 * that would break live sessions if renamed (the kudos_session cookie) are
 * intentionally preserved and asserted here.
 */
describe('RaveWall brand', () => {
  it('names RaveWall in the document title, description and social metadata', () => {
    const html = read('index.html')
    expect(html).toContain('<title>RaveWall — testimonials for every client, one workspace</title>')
    expect(html).toMatch(/name="description"\s+content="RaveWall /s)
    expect(html).toContain('property="og:title" content="RaveWall')
    expect(html).toContain('property="og:description"\n      content="Collect, manage and publish customer testimonials across all your clients from one clean workspace. Free during Early Access, no credit card."')
    expect(html).toContain('name="apple-mobile-web-app-title" content="RaveWall"')
  })

  it('leaves no old product name in the HTML shell', () => {
    const html = read('index.html')
    expect(html).not.toMatch(/PraiseDock|praisedock/)
    expect(html).not.toMatch(/Kudos|kudos/)
  })

  it('references the RaveWall favicon and manifest', () => {
    const html = read('index.html')
    expect(html).toContain('rel="icon" type="image/svg+xml" href="/favicon.svg"')
    expect(html).toContain('rel="manifest" href="/site.webmanifest"')
    expect(read('public/site.webmanifest')).toContain('"name": "RaveWall"')
  })

  it('ships the sprout favicon in the reference green, with no old bubble or star', () => {
    const icon = read('public/favicon.svg')
    expect(icon).toContain('fill="#097441"')
    // The mark is a single evenodd path — no bubble rect, no star cutout.
    expect(icon).not.toContain('<rect')
    expect(icon).not.toContain('fill="#ffffff"')
    expect(icon).not.toMatch(/M16 6\.6/)
    expect(icon).toContain('fill-rule="evenodd"')
    // Square viewBox so the browser tab icon never stretches.
    const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(icon)
    expect(viewBox).not.toBeNull()
    expect(viewBox[1]).toBe(viewBox[2])
  })

  it('ships the icon, wordmark and lockup assets in the reference colours', () => {
    const icon = read('public/ravewall-icon.svg')
    const wordmark = read('public/ravewall-wordmark.svg')
    const lockup = read('public/ravewall-logo.svg')
    expect(icon).toContain('fill="#097441"')
    expect(wordmark).toContain('fill="#0c1615"')
    expect(lockup).toContain('fill="#097441"')
    expect(lockup).toContain('currentColor')
    // The old speech-bubble geometry is gone from every brand asset.
    for (const asset of [icon, wordmark, lockup, read('public/favicon.svg')]) {
      expect(asset).not.toContain('M10 20H16L10.5 28Z')
      expect(asset).not.toContain('<rect')
    }
  })

  it('keeps amber testimonial rating stars separate from the brand mark', () => {
    expect(read('src/client/styles.css')).toMatch(/\.star-on\s*\{\s*color: #f59e0b/)
    expect(read('src/client/components/Stars.tsx')).toContain('star')
  })

  it('brands the app chrome and the public collection/wall footers', () => {
    const files = [
      'src/client/components/Primitives.tsx',
      'src/client/components/AuthShell.tsx',
      'src/client/components/ProductPreview.tsx',
      'src/client/pages/Landing.tsx',
      'src/client/pages/Collect.tsx',
      'src/client/pages/Wall.tsx',
    ]
    for (const file of files) {
      expect(read(file), `${file} should mention RaveWall`).toContain('RaveWall')
      expect(read(file), `${file} should not mention an old product name`).not.toMatch(
        /PraiseDock|praisedock|Kudos|kudos/,
      )
    }
  })

  it('keeps the RaveWall green as the brand and default accent', () => {
    expect(read('src/shared/constants.js')).toContain("DEFAULT_ACCENT = '#15803d'")
    expect(read('src/client/styles.css')).toContain('--brand: #15803d')
    // Rating stars stay amber, never brand green.
    expect(read('src/client/styles.css')).toMatch(/\.star-on\s*\{\s*color: #f59e0b/)
  })

  it('preserves the session cookie name so existing sessions survive', () => {
    expect(read('src/shared/constants.js')).toContain("SESSION_COOKIE = 'kudos_session'")
  })
})
