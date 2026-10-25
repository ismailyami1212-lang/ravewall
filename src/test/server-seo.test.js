import fsp from 'node:fs/promises'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { injectWallMetadata } from '../server/html-meta.js'
import { projectRoot } from '../server/config.js'
import {
  createTestServer,
  seedAccount,
  submitTestimonial,
  tempDir,
} from './helpers/server.js'

let server
let owner
let temp

async function readShell() {
  return fsp.readFile(path.join(projectRoot, 'index.html'), 'utf8')
}

/** Submits a testimonial and approves it so the wall is indexable. */
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

beforeEach(async () => {
  temp = await tempDir()
  await fsp.writeFile(path.join(temp.dir, 'index.html'), await readShell())
  server = await createTestServer({
    staticDir: temp.dir,
    appUrl: 'https://ravewall.test',
  })
  owner = await seedAccount(request, server.app, {
    email: 'mara@example.com',
    name: 'Mara Ellis',
    slug: 'northwind',
    businessName: 'Northwind Studio',
  })
})

afterEach(async () => {
  await server?.cleanup()
  await temp?.cleanup()
})

describe('server-rendered wall metadata', () => {
  it('injects wall title, description, canonical and social tags into the HTML', async () => {
    await publishWall('northwind')

    const response = await request(server.app).get('/wall/northwind').expect(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.headers['cache-control']).toContain('no-cache')

    const html = response.text
    expect(html).toContain('<title>Northwind Studio — customer testimonials</title>')
    expect(html).toContain(
      '<link rel="canonical" href="https://ravewall.test/wall/northwind" />',
    )
    expect(html).toContain('property="og:title" content="Northwind Studio — customer testimonials"')
    expect(html).toContain('property="og:url" content="https://ravewall.test/wall/northwind"')
    expect(html).toContain('property="og:image" content="https://ravewall.test/og-image.png"')
    expect(html).toContain('property="og:image:width" content="1200"')
    expect(html).toContain('name="twitter:image" content="https://ravewall.test/og-image.png"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')

    const description = /<meta name="description" content="([^"]*)" \/>/.exec(html)?.[1] ?? ''
    expect(description).toContain('Read what Northwind Studio')
    expect(description).toContain('1 testimonial on RaveWall')
    expect(html).not.toContain('name="robots" content="noindex')
  })

  it('returns a real 404 with noindex for a missing wall', async () => {
    const response = await request(server.app).get('/wall/does-not-exist').expect(404)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.text).toContain('<title>Wall not found — RaveWall</title>')
    expect(response.text).toContain('<meta name="robots" content="noindex, follow" />')
    expect(response.text).toContain('https://ravewall.test/wall/does-not-exist')
  })

  it('returns noindex for a wall with no approved testimonials', async () => {
    await seedAccount(request, server.app, {
      email: 'tobias@example.com',
      name: 'Tobias',
      slug: 'fieldnote',
      businessName: 'Fieldnote',
    })

    const response = await request(server.app).get('/wall/fieldnote').expect(200)
    expect(response.text).toContain('<title>Fieldnote — customer testimonials</title>')
    expect(response.text).toContain('<meta name="robots" content="noindex, follow" />')
  })

  it('escapes user-controlled metadata before it reaches the shell', async () => {
    const html = injectWallMetadata(await readShell(), {
      business: {
        name: '</title><script>alert(1)</script>',
        slug: 'unsafe',
        tagline: '',
        logoUrl: '',
      },
      stats: { count: 1, averageRating: 5 },
      origin: 'https://ravewall.test',
      slug: 'unsafe',
    })

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('Vercel routing for server-side metadata', () => {
  it('routes wall pages through the function and bundles the shell', async () => {
    const config = JSON.parse(
      await fsp.readFile(path.join(projectRoot, 'vercel.json'), 'utf8'),
    )
    expect(config.rewrites).toContainEqual({
      source: '/wall/(.*)',
      destination: '/api/handler',
    })
    expect(config.functions['api/handler.js'].includeFiles).toContain('dist/index.html')
  })
})
