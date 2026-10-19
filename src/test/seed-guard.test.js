/**
 * Demo data safety.
 *
 * The brief is explicit: the demo account must never exist automatically in
 * production. The seeder is a manual command (there is no install/start hook),
 * and it refuses to run against a server that reports itself as production.
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let server
let base
let requests = 0

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests += 1
    if (req.url === '/api/health') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: { status: 'ok', environment: 'production' } }))
      return
    }
    // Any write attempt is recorded; the guard must stop us before this point.
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

function runSeed(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/seed-demo.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, BASE_URL: base, ...env },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('seed script timed out'))
    }, 30_000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

describe('demo seeder', () => {
  it('refuses to write demo data to a production server', async () => {
    const before = requests
    const result = await runSeed({ ALLOW_DEMO_SEED: '' })

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/Refusing to seed demo data/)
    expect(result.stderr).toMatch(/production/)

    // It checked health and then stopped: no signup was attempted.
    expect(requests - before).toBe(1)
  })

  it('proceeds past the guard only when explicitly overridden', async () => {
    const result = await runSeed({ ALLOW_DEMO_SEED: '1' })

    // The override lets it continue; it then fails on the fake server's 404,
    // which is proof the guard was bypassed rather than tripped.
    expect(result.stderr).not.toMatch(/Refusing to seed demo data/)
    expect(result.stderr).toMatch(/signup failed|no session cookie/i)
  })

  it('is not wired into install or start', async () => {
    const pkg = await import('../../package.json', { with: { type: 'json' } })
    const scripts = pkg.default.scripts
    for (const hook of ['preinstall', 'postinstall', 'prepare', 'prestart', 'poststart']) {
      expect(scripts[hook], `${hook} must not run the seeder`).toBeUndefined()
    }
    expect(scripts.start).not.toMatch(/seed/)
    expect(scripts.seed).toMatch(/seed-demo/)
  })
})
