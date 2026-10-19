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

describe('robots.txt', () => {
  it('exists as a real file, allows public content and blocks private routes', () => {
    const robots = readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8')
    expect(robots).toContain('User-agent: *')
    expect(robots).toContain('Disallow: /api/')
    expect(robots).toContain('Disallow: /dashboard')
    expect(robots).toContain('Disallow: /settings')
    expect(robots).toContain('Disallow: /login')
    expect(robots).toContain('Disallow: /signup')
    expect(robots).toContain('Disallow: /t/')
    expect(robots).toContain('Sitemap: https://ravewall.vercel.app/sitemap.xml')
  })
})

describe('sitemap.xml', () => {
  it('serves valid XML with the core pages and every public wall', async () => {
    const response = await request(server.app).get('/sitemap.xml').expect(200)
    expect(response.headers['content-type']).toContain('xml')
    expect(response.headers['cache-control']).toContain('public')

    const body = response.text
    expect(body.startsWith('<?xml')).toBe(true)
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(body).toMatch(/<loc>https:\/\/127\.0\.0\.1[^<]*<\/loc>/)
    expect(body).toContain('<priority>1.0</priority>')
    expect(body).toMatch(/<loc>https:\/\/127\.0\.0\.1[^<]*\/privacy<\/loc>/)
    expect(body).toMatch(/<loc>https:\/\/127\.0\.0\.1[^<]*\/terms<\/loc>/)
    expect(body).toMatch(/<loc>https:\/\/127\.0\.0\.1[^<]*\/wall\/northwind<\/loc>/)

    // Private routes are never included.
    expect(body).not.toContain('/dashboard')
    expect(body).not.toContain('/settings')
    expect(body).not.toContain('/login')
    expect(body).not.toContain('/signup')
  })

  it('lists new businesses automatically', async () => {
    await seedAccount(request, server.app, {
      email: 'tobias@example.com',
      name: 'Tobias',
      slug: 'fieldnote',
      businessName: 'Fieldnote',
    })
    const response = await request(server.app).get('/sitemap.xml').expect(200)
    expect(response.text).toContain('/wall/fieldnote')
    expect(response.text).toContain('/wall/northwind')
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
    expect(html).toContain('<link rel="canonical" href="https://ravewall.vercel.app/" />')
    expect(html).toContain('property="og:site_name" content="RaveWall"')
    expect(html).toContain('property="og:url" content="https://ravewall.vercel.app/"')
    expect(html).toContain('name="twitter:title"')
    expect(html).toContain('name="twitter:description"')
  })
})
