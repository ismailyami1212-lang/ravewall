/**
 * Seeds a demo account so the app can be explored without filling in forms.
 *
 *   npm run seed                          # against http://127.0.0.1:3001
 *   BASE_URL=http://127.0.0.1:3999 npm run seed
 *
 * DEVELOPMENT ONLY. This never runs automatically and it refuses to touch a
 * production server unless ALLOW_DEMO_SEED=1 is set explicitly, so the demo
 * credentials cannot appear in a real deployment by accident.
 *
 * Safe to re-run: if the demo account already has testimonials it does nothing.
 */
const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@kudos.test'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Passw0rd!'
const SLUG = process.env.DEMO_SLUG ?? 'northwind'

const DEMO = [
  {
    rating: 5,
    name: 'Mara Ellis',
    company: 'Northwind Studio',
    text: 'They rebuilt our pricing page in a week and conversion went up 18%. The whole process was calm and predictable.',
    status: 'approved',
  },
  {
    rating: 5,
    name: 'Tobias Lang',
    company: 'Fieldnote',
    text: 'The moderation queue is the part I did not know I needed. Nothing reaches the public page until we say so.',
    status: 'approved',
  },
  {
    rating: 4,
    name: 'Priya Raman',
    company: 'Cobalt Labs',
    text: 'Set up in about two minutes, sent the link, had eleven testimonials by the next morning.',
    status: 'approved',
  },
  {
    rating: 5,
    name: 'Danny Okonkwo',
    company: 'Lantern Health',
    text: 'Our sales team now pastes real quotes into proposals instead of writing them by hand. Huge time saver.',
    status: 'approved',
  },
  {
    rating: 4,
    name: 'Sofia Marchetti',
    company: 'Ridgeway Partners',
    text: 'Clean, fast, and it looks like part of our own site rather than a third-party widget.',
    status: 'approved',
  },
  {
    rating: 5,
    name: 'Idris Bello',
    company: '',
    text: 'Genuinely the simplest tool we have added this year. It just works and the wall looks great.',
    status: 'pending',
  },
  {
    rating: 3,
    name: 'Hannah Cole',
    company: 'Bright Path',
    text: 'Good product overall, though I would like more control over how the wall is sorted.',
    status: 'pending',
  },
  {
    rating: 2,
    name: 'Cheap Followers',
    company: 'Deals Direct',
    text: 'BUY CHEAP FOLLOWERS AT OUR SITE NOW, BEST PRICES GUARANTEED FOR ALL ACCOUNTS.',
    status: 'rejected',
  },
]

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON response */
  }
  return { status: response.status, payload, headers: response.headers }
}

async function signIn() {
  const signup = await call('/api/auth/signup', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD, name: 'Demo Owner' },
  })

  if (signup.status === 201) {
    return /kudos_session=([^;]+)/.exec(signup.headers.getSetCookie?.()[0] ?? '')?.[1]
  }
  if (signup.status === 409) {
    const login = await call('/api/auth/login', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD },
    })
    if (login.status !== 200) {
      throw new Error(`could not sign in as ${EMAIL}: ${login.status}`)
    }
    return /kudos_session=([^;]+)/.exec(login.headers.getSetCookie?.()[0] ?? '')?.[1]
  }
  throw new Error(`signup failed with ${signup.status}`)
}

async function main() {
  const health = await call('/api/health').catch(() => null)
  if (!health || health.status !== 200) {
    throw new Error(`No server responding at ${BASE}. Start it with "npm start" first.`)
  }

  // Hard stop: demo credentials must never be created on a live deployment.
  if (health.payload?.data?.environment === 'production' && process.env.ALLOW_DEMO_SEED !== '1') {
    throw new Error(
      'Refusing to seed demo data: the server at ' +
        `${BASE} reports environment "production".\n` +
        'Demo credentials must not exist on a real deployment. Set ALLOW_DEMO_SEED=1 only if you ' +
        'genuinely intend to write demo data there.',
    )
  }

  const token = await signIn()
  if (!token) throw new Error('no session cookie returned')
  const cookie = `kudos_session=${token}`

  const business = await call('/api/business', {
    method: 'POST',
    cookie,
    body: {
      name: 'Northwind Studio',
      slug: SLUG,
      tagline: 'Design studio for ambitious teams',
      accentColor: '#15803d',
    },
  })
  if (![201, 409].includes(business.status)) {
    throw new Error(`business setup failed with ${business.status}`)
  }

  // Idempotent per entry: re-running tops up whatever is missing rather than
  // bailing out because one testimonial already exists.
  const existing = await call('/api/testimonials?status=all', { cookie })
  const existingNames = new Set(
    (existing.payload?.data?.items ?? []).map((item) => item.name),
  )

  let added = 0
  let skipped = 0

  for (const entry of DEMO) {
    if (existingNames.has(entry.name)) {
      skipped += 1
      continue
    }

    const created = await call(`/api/public/submit/${SLUG}`, {
      method: 'POST',
      body: {
        rating: entry.rating,
        name: entry.name,
        company: entry.company,
        text: entry.text,
      },
    })

    if (created.status === 429) {
      console.warn(
        `  rate limited while adding "${entry.name}" — wait for the window to pass and re-run`,
      )
      skipped += 1
      continue
    }
    if (created.status !== 201) {
      console.warn(`  skipped "${entry.name}" (${created.status})`)
      skipped += 1
      continue
    }

    added += 1
    if (entry.status === 'pending') continue

    const pending = await call('/api/testimonials?status=pending', { cookie })
    const match = pending.payload?.data?.items?.find((item) => item.name === entry.name)
    if (!match) continue
    await call(`/api/testimonials/${match.id}`, {
      method: 'PATCH',
      cookie,
      body: { status: entry.status },
    })
  }

  if (skipped > 0) console.log(`  ${skipped} entr(ies) already present or skipped.`)

  const stats = await call('/api/testimonials?status=all', { cookie })
  console.log(`Demo data ready (${added} added).`)
  console.log(`  collection link : ${BASE}/t/${SLUG}`)
  console.log(`  public wall     : ${BASE}/wall/${SLUG}`)
  console.log(`  dashboard       : ${BASE}/dashboard`)
  console.log(`  email           : ${EMAIL}`)
  console.log(`  password        : ${PASSWORD}`)
  console.log(`  testimonials    : ${JSON.stringify(stats.payload?.data?.stats)}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
