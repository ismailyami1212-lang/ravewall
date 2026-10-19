/**
 * Production smoke test for the deployed RaveWall app.
 * Runs every critical flow end-to-end and cleans up afterwards.
 */

const BASE = process.env.SMOKE_BASE || 'https://ravewall.vercel.app'
const COOKIE_JAR = new Map()

let failures = 0
let checks = 0

function check(name, condition, detail = '') {
  checks++
  if (!condition) {
    failures++
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    console.log(`PASS: ${name}`)
  }
}

async function req(path, opts = {}) {
  const url = `${BASE}${path}`
  const headers = { ...opts.headers }
  const cookie = COOKIE_JAR.get(BASE)
  if (cookie && !opts.noCookie) headers.cookie = cookie

  const res = await fetch(url, {
    ...opts,
    headers,
  })

  const setCookie = res.headers.get('set-cookie')
  if (setCookie) {
    const parsed = setCookie.split(';')[0]
    COOKIE_JAR.set(BASE, parsed)
  }

  let body
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    body = await res.json()
  } else {
    body = await res.text()
  }
  return { status: res.status, headers: res.headers, body }
}

async function run() {
  console.log(`\n=== RaveWall Production Smoke Tests ===\nBase: ${BASE}\n`)

  // 1. Health
  {
    const r = await req('/api/health')
    check('health returns 200', r.status === 200)
    check('health status ok', r.body?.data?.status === 'ok')
    check('health database ok', r.body?.data?.database === 'ok')
    check('health environment is production', r.body?.data?.environment === 'production')
  }

  // 2. Anonymous /me
  {
    const r = await req('/api/auth/me', { noCookie: true })
    check('anonymous /me returns 200', r.status === 200)
    check('anonymous /me user is null', r.body?.data?.user === null)
  }

  // 3. SPA shell
  {
    const r = await req('/dashboard')
    check('SPA /dashboard returns 200', r.status === 200)
    check('SPA shell contains root div', typeof r.body === 'string' && r.body.includes('id="root"'))
  }

  // 4. Security headers
  {
    const r = await req('/api/health')
    check('has X-Content-Type-Options', r.headers.get('x-content-type-options') === 'nosniff')
    const csp = r.headers.get('content-security-policy') || ''
    check('has CSP with frame-ancestors', csp.includes("frame-ancestors 'none'"))
    check('has Referrer-Policy', r.headers.get('referrer-policy') === 'strict-origin-when-cross-origin')
    check('has HSTS (production)', r.headers.get('strict-transport-security')?.includes('max-age='))
  }

  // 5. Signup
  const email = `smoke-${Date.now()}@example.com`
  const password = 'SmokeTest123!'
  {
    const r = await req('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Smoke User' }),
    })
    check('signup returns 201', r.status === 201)
    check('signup returns user', typeof r.body?.data?.user?.id === 'string')
    check('signup sets session cookie', COOKIE_JAR.has(BASE))
  }

  // 6. /me after login
  {
    const r = await req('/api/auth/me')
    check('/me after signup returns 200', r.status === 200)
    check('/me email matches', r.body?.data?.user?.email === email)
    check('/me has no business yet', r.body?.data?.business === null)
  }

  // 7. Business creation
  let business
  {
    const r = await req('/api/business', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Smoke Business',
        slug: `smoke-biz-${Date.now()}`,
        tagline: 'We test things',
        logoUrl: '',
        accentColor: '#3b82f6',
      }),
    })
    check('create business returns 201', r.status === 201)
    check('business has id', typeof r.body?.data?.business?.id === 'string')
    business = r.body?.data?.business
  }

  // 8. Anonymous testimonial submission (public)
  {
    const r = await req(`/api/public/submit/${business.slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      noCookie: true,
      body: JSON.stringify({
        name: 'Anonymous Fan',
        company: 'Fan Corp',
        text: 'This is a genuinely great product!',
        rating: 5,
      }),
    })
    check('anonymous submit returns 201', r.status === 201)
    check('anonymous submit accepted', r.body?.data?.accepted === true)
  }

  // 9. List testimonials (owner inbox)
  let anonTestimonialId
  {
    const r = await req('/api/testimonials')
    check('list testimonials returns 200', r.status === 200)
    check('list has items array', Array.isArray(r.body?.data?.items))
    const items = r.body?.data?.items || []
    check('list has at least one testimonial', items.length >= 1)
    anonTestimonialId = items[0]?.id
  }

  // 10. Public wall (should be empty because testimonial is pending)
  {
    const r = await req(`/api/public/wall/${business.slug}`, { noCookie: true })
    check('public wall returns 200', r.status === 200)
    check('public wall has business name', r.body?.data?.business?.name === 'Smoke Business')
    check('public wall lists testimonials', Array.isArray(r.body?.data?.testimonials))
    check('public wall empty while pending', r.body?.data?.testimonials?.length === 0)
  }

  // 11. Approve testimonial
  {
    const r = await req(`/api/testimonials/${anonTestimonialId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    check('approve returns 200', r.status === 200)
    check('approve returns testimonial', typeof r.body?.data?.testimonial?.id === 'string')
  }

  // 12. Public wall now shows approved testimonial
  {
    const r = await req(`/api/public/wall/${business.slug}`, { noCookie: true })
    check('public wall has testimonial after approve', r.body?.data?.testimonials?.length === 1)
  }

  // 13. Reject a testimonial (submit another then reject)
  {
    const s = await req(`/api/public/submit/${business.slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      noCookie: true,
      body: JSON.stringify({ name: 'Reject Me', company: 'X', text: 'Not a fan of this one honestly.', rating: 2 }),
    })
    check('second submit returns 201', s.status === 201)

    const list = await req('/api/testimonials')
    const rejectId = list.body?.data?.items?.find(t => t.name === 'Reject Me')?.id

    const r = await req(`/api/testimonials/${rejectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    })
    check('reject returns 200', r.status === 200)

    // 14. Delete rejected testimonial
    const d = await req(`/api/testimonials/${rejectId}`, { method: 'DELETE' })
    check('delete returns 200', d.status === 200)
    const list2 = await req('/api/testimonials')
    check('deleted testimonial is gone', !list2.body?.data?.items?.some(t => t.id === rejectId))
  }

  // 15. Cross-tenant isolation — create a second user with their own business
  const email2 = `intruder-${Date.now()}@example.com`
  {
    // Signup as second user
    const jar2 = new Map()
    const res2 = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email2, password: 'Intruder123!', name: 'Intruder' }),
    })
    const setCookie = res2.headers.get('set-cookie')
    if (setCookie) jar2.set(BASE, setCookie.split(';')[0])

    // Create a business for the intruder so requireBusiness passes
    await fetch(`${BASE}/api/business`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jar2.get(BASE) || '',
      },
      body: JSON.stringify({
        name: 'Intruder Inc',
        slug: `intruder-biz-${Date.now()}`,
        tagline: 'Evil',
        logoUrl: '',
        accentColor: '#ef4444',
      }),
    })

    // Try to access first user's testimonials
    const r = await fetch(`${BASE}/api/testimonials`, {
      headers: { cookie: jar2.get(BASE) || '' },
    })
    const body = await r.json()
    check('cross-tenant: intruder cannot see smoke testimonials', !body?.data?.items?.some(t => t.id === anonTestimonialId))

    // Try to approve first user's testimonial
    const r2 = await fetch(`${BASE}/api/testimonials/${anonTestimonialId}`, {
      method: 'PATCH',
      headers: { cookie: jar2.get(BASE) || '', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    check('cross-tenant: patch returns 404 (not 403)', r2.status === 404)

    // Try to access first user's /me
    const r3 = await fetch(`${BASE}/api/auth/me`, {
      headers: { cookie: jar2.get(BASE) || '' },
    })
    const me3 = await r3.json()
    check('cross-tenant: intruder /me is their own account', me3?.data?.user?.email === email2)
  }

  // 16. Logout
  {
    const r = await req('/api/auth/logout', { method: 'POST' })
    check('logout returns 204', r.status === 204)
    const r2 = await req('/api/auth/me')
    check('after logout /me is anonymous', r2.body?.data?.user === null)
  }

  // 17. Login
  {
    const r = await req('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    check('login returns 200', r.status === 200)
    check('login returns correct user', r.body?.data?.user?.email === email)
  }

  // 18. Rate limiting
  {
    const attempts = []
    for (let i = 0; i < 15; i++) {
      const r = await req('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        noCookie: true,
        body: JSON.stringify({ email: `rate-${Date.now()}-${i}@example.com`, password: 'wrong' }),
      })
      attempts.push(r.status)
    }
    check('rate limit eventually triggers 429', attempts.includes(429))
  }

  // 19. RLS — anonymous cannot read testimonials
  {
    const r = await req('/api/testimonials', { noCookie: true })
    check('anonymous list testimonials returns 401', r.status === 401)
  }

  // 20. Deployment verification
  {
    console.log('\n--- deployment verification ---')
    const r = await req('/api/health')
    check('deployment: database reachable', r.body?.data?.database === 'ok')
  }

  // ========================
  // Cleanup
  // ========================
  console.log('\n--- cleanup ---')
  // Re-login as smoke user if needed
  const me = await req('/api/auth/me')
  if (me.body?.data?.user?.email !== email) {
    await req('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  }

  // Delete the remaining approved testimonial
  if (anonTestimonialId) {
    const r = await req(`/api/testimonials/${anonTestimonialId}`, { method: 'DELETE' })
    check(`cleanup: delete testimonial ${anonTestimonialId}`, r.status === 200 || r.status === 404)
  }

  console.log('Smoke accounts will be cleaned via direct DB.')
  console.log(`\n=== Results: ${checks - failures}/${checks} passed ===`)
  if (failures > 0) process.exit(1)
}

run().catch(e => {
  console.error('Unhandled error:', e)
  process.exit(1)
})
