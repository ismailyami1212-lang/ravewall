import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestServer, seedAccount, submitTestimonial } from './helpers/server.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let server
let owner

beforeEach(async () => {
  server = await createTestServer()
  owner = await seedAccount(request, server.app, {
    email: 'mara@example.com',
    name: 'Mara Ellis',
    slug: 'northwind',
    businessName: 'Northwind Studio',
  })
})

afterEach(async () => {
  await server.cleanup()
})

/** Submits a testimonial and approves it so the wall becomes indexable. */
async function publishWall(slug = 'northwind') {
  await submitTestimonial(server.app, slug)
  const [row] = await server.sql(
    `SELECT t.id
       FROM testimonials t
       JOIN businesses b ON b.id = t.business_id
      WHERE b.slug = $1
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [slug],
  )
  await owner.patch(`/api/testimonials/${row.id}`).send({ status: 'approved' }).expect(200)
}

describe('robots.txt', () => {
  it('exists as a real file, allows public content and blocks private routes', () => {
    const robots = readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8')
    expect(robots).toContain('User-agent: *')
    expect(robots).toContain('Disallow: /api/')
    expect(robots).toContain('Disallow: /dashboard')
    expect(robots).toContain('Disallow: /clients')
    expect(robots).toContain('Disallow: /team')
    expect(robots).toContain('Disallow: /analytics')
    expect(robots).toContain('Disallow: /account')
    expect(robots).toContain('Disallow: /settings')
    expect(robots).toContain('Disallow: /login')
    expect(robots).toContain('Disallow: /signup')
    expect(robots).toContain('Disallow: /t/')
    expect(robots).toContain('Sitemap: https://ravewall.vercel.app/sitemap.xml')
  })
})

describe('sitemap.xml', () => {
  it('serves valid XML with the core pages and indexable walls', async () => {
    await publishWall('northwind')

    const response = await request(server.app).get('/sitemap.xml').expect(200)
    expect(response.headers['content-type']).toContain('xml')
    expect(response.headers['cache-control']).toContain('public')

    const body = response.text
    expect(body.startsWith('<?xml')).toBe(true)
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(body).toMatch(/<loc>http:\/\/127\.0\.0\.1[^<]*<\/loc>/)
    expect(body).toContain('<priority>1.0</priority>')
    expect(body).toMatch(/<loc>http:\/\/127\.0\.0\.1[^<]*\/privacy<\/loc>/)
    expect(body).toMatch(/<loc>http:\/\/127\.0\.0\.1[^<]*\/terms<\/loc>/)
    expect(body).toMatch(/<loc>http:\/\/127\.0\.0\.1[^<]*\/wall\/northwind<\/loc>/)
    expect(body).toMatch(
      /<url><loc>http:\/\/127\.0\.0\.1[^<]*\/wall\/northwind<\/loc><lastmod>[^<]+<\/lastmod>/,
    )

    // Every URL carries a lastmod, including the static pages.
    expect((body.match(/<lastmod>/g) ?? []).length).toBeGreaterThanOrEqual(5)

    // Private routes are never included.
    expect(body).not.toContain('/dashboard')
    expect(body).not.toContain('/settings')
    expect(body).not.toContain('/login')
    expect(body).not.toContain('/signup')
  })

  it('lists a wall only after it has an approved testimonial', async () => {
    await seedAccount(request, server.app, {
      email: 'tobias@example.com',
      name: 'Tobias',
      slug: 'fieldnote',
      businessName: 'Fieldnote',
    })

    let response = await request(server.app).get('/sitemap.xml').expect(200)
    expect(response.text).not.toContain('/wall/fieldnote')
    expect(response.text).not.toContain('/wall/northwind')

    await publishWall('northwind')

    response = await request(server.app).get('/sitemap.xml').expect(200)
    expect(response.text).toContain('/wall/northwind')
    expect(response.text).not.toContain('/wall/fieldnote')
  })

  it('exists as a real route, not an SPA fallback', async () => {
    // A JSON-accepting client must not receive the HTML shell here.
    const response = await request(server.app).get('/sitemap.xml')
    expect(response.headers['content-type']).not.toContain('html')
  })
})

describe('static shell metadata', () => {
  it('declares the canonical URL and social metadata', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    expect(html).toContain('<link rel="canonical" href="/" />')
    expect(html).toContain('property="og:site_name" content="RaveWall"')
    expect(html).toContain('property="og:url" content="https://ravewall.vercel.app/"')
    expect(html).toContain('property="og:image" content="https://ravewall.vercel.app/og-image.png"')
    expect(html).toContain('property="og:image:width" content="1200"')
    expect(html).toContain('property="og:image:height" content="630"')
    expect(html).toContain('property="og:locale" content="en_US"')
    expect(html).toContain('name="twitter:title"')
    expect(html).toContain('name="twitter:description"')
    expect(html).toContain('name="twitter:image" content="https://ravewall.vercel.app/og-image.png"')
    expect(html).toContain('name="twitter:site" content="@ravewall"')
    expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"')
  })

  it('publishes site-wide Organization, WebSite and SoftwareApplication JSON-LD', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    expect(match).not.toBeNull()

    const graph = JSON.parse(match[1])['@graph']
    const types = graph.map((node) => node['@type'])
    expect(types).toContain('Organization')
    expect(types).toContain('WebSite')
    expect(types).toContain('SoftwareApplication')

    const app = graph.find((node) => node['@type'] === 'SoftwareApplication')
    expect(app.applicationCategory).toBe('BusinessApplication')
    expect(app.operatingSystem).toBe('Web')
    expect(Array.isArray(app.featureList)).toBe(true)
    expect(app.offers['@type']).toBe('Offer')

    const site = graph.find((node) => node['@type'] === 'WebSite')
    expect(site.potentialAction['@type']).toBe('SearchAction')
  })
})
