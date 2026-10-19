/**
 * Vercel serverless adapter.
 *
 * Drives the exported handler over a real HTTP socket with an injected
 * bootstrap, so the adapter's request forwarding, readiness caching and
 * cold-start failure behaviour are tested without needing a live database.
 */
import fsp from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServerlessHandler } from '../../api/handler.js'
import { projectRoot } from '../server/config.js'
import { createTestServer } from './helpers/server.js'

let server
let httpServer
let baseUrl

async function listen(handler) {
  const created = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(() => {
      res.statusCode = 500
      res.end()
    })
  })
  await new Promise((resolve) => created.listen(0, '127.0.0.1', resolve))
  return { created, url: `http://127.0.0.1:${created.address().port}` }
}

beforeEach(async () => {
  server = await createTestServer()
})

afterEach(async () => {
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve))
  httpServer = null
  vi.restoreAllMocks()
  await server.cleanup()
})

describe('serverless handler', () => {
  it('serves API requests through the injected bootstrap', async () => {
    const handler = createServerlessHandler(async () => server.app)
    const started = await listen(handler)
    httpServer = started.created
    baseUrl = started.url

    const health = await fetch(`${baseUrl}/api/health`)
    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toMatchObject({ data: { status: 'ok' } })

    // A second path proves the original URL survives to Express.
    const anonymous = await fetch(`${baseUrl}/api/testimonials`)
    expect(anonymous.status).toBe(401)
  })

  it('caches the bootstrap across requests', async () => {
    const bootstrap = vi.fn(async () => server.app)
    const handler = createServerlessHandler(bootstrap)
    const started = await listen(handler)
    httpServer = started.created
    baseUrl = started.url

    await fetch(`${baseUrl}/api/health`)
    await fetch(`${baseUrl}/api/health`)
    await fetch(`${baseUrl}/api/health`)

    expect(bootstrap).toHaveBeenCalledTimes(1)
  })

  it('answers 503 without leaking details when the cold start fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = createServerlessHandler(async () => {
      throw new Error('could not connect to postgresql://user:hunter2@db.example.com:5432/kudos')
    })
    const started = await listen(handler)
    httpServer = started.created
    baseUrl = started.url

    const response = await fetch(`${baseUrl}/api/health`)
    expect(response.status).toBe(503)

    const text = await response.text()
    expect(JSON.parse(text)).toEqual({
      error: {
        code: 'database_unavailable',
        message: 'The service is temporarily unavailable. Please try again in a moment.',
      },
    })
    // The connection string, the password and the stack must not reach the client.
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('postgresql://')
    expect(text).not.toContain('db.example.com')
  })

  it('retries the bootstrap on the next request after a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let attempts = 0
    const handler = createServerlessHandler(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('transient cold start failure')
      return server.app
    })
    const started = await listen(handler)
    httpServer = started.created
    baseUrl = started.url

    expect((await fetch(`${baseUrl}/api/health`)).status).toBe(503)
    // A failed bootstrap must not be cached, or the instance stays broken.
    const second = await fetch(`${baseUrl}/api/health`)
    expect(second.status).toBe(200)
    expect(attempts).toBe(2)
  })
})

/**
 * A schema change must never be a side effect of starting an application.
 * Applying migrations on a cold start would also race across instances, and the
 * serverless bundle is not guaranteed to contain `supabase/migrations` at all.
 */
describe('migrations are never applied at boot', () => {
  const read = (relative) => fsp.readFile(path.join(projectRoot, relative), 'utf8')

  it('the serverless entry point does not migrate', async () => {
    const source = await read(path.join('api', 'handler.js'))
    expect(source).not.toMatch(/runMigrations/)
    expect(source).toMatch(/assertSchemaReady/)
  })

  it('the long-running server does not migrate', async () => {
    const source = await read(path.join('src', 'server', 'index.js'))
    expect(source).not.toMatch(/runMigrations/)
    expect(source).toMatch(/assertSchemaReady/)
  })

  it('the local development harness does migrate, because it owns a throwaway database', async () => {
    const source = await read(path.join('scripts', 'dev-server.mjs'))
    expect(source).toMatch(/runMigrations/)
  })
})
