# RaveWall — testimonial collection platform

A complete testimonial platform. Every business gets a unique collection link, a moderation
inbox, and a public wall that only ever shows what was approved.

- **Stack:** Node 20.11+ / Express 4 (ESM) · React 19 + TypeScript + Vite 6 · PostgreSQL (Supabase)
- **Persistence:** Supabase Postgres, accessed only by the API with a server-side connection string
- **Auth:** email + password, scrypt hashing, httpOnly session cookies, sessions in Postgres
- **Runtime dependencies:** Express, helmet, compression, cookie-parser, pg, zod

---

## Requirements

- Node.js **20.11 or newer** (developed on 22.x)
- A PostgreSQL database. Supabase is the supported target; any Postgres 13+ works.
  Local development needs neither — see below.

---

## Quick start

### Local development (no database account required)

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The API runs on :3001 against an **in-process PostgreSQL**
(PGlite, real Postgres compiled to WebAssembly) persisted to `./.pglite`. Migrations run
automatically on boot, so there is nothing to configure.

`npm run dev` is a development harness, not a storage fallback: it refuses to start when
`NODE_ENV=production`, and `npm start` requires `SUPABASE_DB_URL`.

### Against Supabase

```bash
cp .env.example .env      # fill in SUPABASE_DB_URL and SESSION_SECRET
npm run migrate           # create the schema
npm run build
npm start                 # serves the API and ./dist on a single port
```

---

## Supabase setup

1. Create a project at <https://supabase.com/dashboard>.
2. Open **Connect → Connection string → URI**.
3. Copy the **Transaction pooler** string (port `6543`) — this is the runtime connection.
4. Copy the **Session pooler** string (port `5432`) — this is the migration connection.
5. Replace `[YOUR-PASSWORD]` in both with the database password you chose.
6. Put them in `.env` (see below) and generate a session secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
7. Run `npm run migrate`.

### Why two connection strings

Migrations take a Postgres **advisory lock**, and advisory locks are *session* scoped. The
transaction pooler multiplexes statements across backends, so a lock taken there is not
guaranteed to hold — a real hazard when several instances cold-start at once. The session pooler
keeps one backend for the whole session, which is what the migration runner needs.

The app also warns at boot if it detects migrations running over port `6543` without a separate
migration URL. Leave `SUPABASE_MIGRATION_DB_URL` empty to reuse the runtime URL (fine for a
long-running server on the direct connection, not for serverless).

**No API keys are required.** The browser never talks to Supabase — there is no publishable
key, no anon key and no service-role key anywhere in the front end or in this repository.
The API is the only database client.

---

## Local environment file

Configuration lives in `.env` at the project root. It is gitignored and is read automatically by
`npm start`, `npm run migrate`, `npm run verify:deployment` and the serverless function.

```bash
cp .env.example .env     # then fill in the three required values
```

| Key | Where it comes from | Who reads it |
| --- | --- | --- |
| `SUPABASE_DB_URL` | Supabase → Connect → **Transaction pooler** URI (port 6543) | the running app |
| `SUPABASE_MIGRATION_DB_URL` | Supabase → Connect → **Session pooler** URI (port 5432) | `npm run migrate` only |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` | the running app |

A real environment variable always wins over a value in the file, so a platform's configuration
is never overridden by a stray `.env`. `npm run dev` needs neither — it runs an in-process
database.

---

## Configuration

All settings come from the environment. See `.env.example` for the annotated list.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SUPABASE_DB_URL` | **yes** | — | Runtime Postgres connection string. Server-side only. |
| `SUPABASE_MIGRATION_DB_URL` | admin only | falls back to `SUPABASE_DB_URL` | Session-pooler connection read only by `npm run migrate` and `npm run verify:deployment`. Do not set it on a deployed runtime. |
| `SESSION_SECRET` | **yes** | — | ≥ 32 chars. Peppers the HMAC of every session token. |
| `NODE_ENV` | no | `development` | `development` / `test` / `production` |
| `PORT` | no | `3001` | Most platforms inject this. |
| `HOST` | no | `0.0.0.0` | Keep as-is behind a proxy. |
| `APP_URL` | no | — | Public origin, e.g. `https://ravewall.example.com` |
| `PG_POOL_MAX` | no | `5` in production | Keep at 1–3 on serverless. |
| `SESSION_TTL_DAYS` | no | `30` | Session lifetime. |
| `ALLOWED_ORIGINS` | no | — | Extra origins allowed to call the API. |
| `TRUST_PROXY` | no | `1` | Must stay `1` for correct client IPs. |
| `RATE_LIMIT_AUTH_MAX` / `_WINDOW_MS` | no | `10` / `300000` | Login + signup. Counted in Postgres. |
| `RATE_LIMIT_SUBMIT_MAX` / `_WINDOW_MS` | no | `8` / `600000` | Public submissions. Counted in Postgres. |
| `RATE_LIMIT_API_MAX` / `_WINDOW_MS` | no | `600` / `300000` | General API. Per instance. |
| `SUBMISSION_DAILY_QUOTA` | no | `200` | Rolling 24h ceiling per business. |
| `RESEND_API_KEY` | no | — | Enables transactional email. Absent → development transport (logged, not sent). |
| `EMAIL_FROM` | no | `RaveWall <onboarding@resend.dev>` | Sender. The default is Resend's **test** sender, deliverable only to the Resend account owner. |
| `EMAIL_TEST_RECIPIENT` | no | — | Optional guard: when set, only this address receives mail; all other recipients are skipped locally. |

Startup **fails** when a required value is missing, naming every problem at once. There is no
fallback storage engine.

### Email (password reset)

The password-reset architecture is complete and does not depend on a verified domain:

- **No key** → development transport. The reset link is logged (and appended to `DEV_EMAIL_LOG`
  when set), so the full flow is testable without an inbox.
- **Key + test sender** (`onboarding@resend.dev`) → Resend's shared sender. Resend only delivers
  it to the account owner's own address; it is for technical verification, **not** for real
  customers. Set `EMAIL_TEST_RECIPIENT` to that address so the server never even attempts a send
  to anyone else.
- **Key + verified domain** → the only mode suitable for real users. Verify a domain in Resend
  and set `EMAIL_FROM` to an address on it. No code change is needed.

The server logs the active email mode at boot and warns loudly when the test sender is in use.

---

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | In-process Postgres + Vite dev server |
| `npm run build` | Production bundle into `dist/` |
| `npm start` | Production server (requires `SUPABASE_DB_URL`) |
| `npm run serve` | `build` then `start` |
| `npm run migrate` | Apply pending SQL migrations and print the history |
| `npm run verify:deployment` | Check a live database: tables, indexes, functions, constraints, RLS |
| `npm run seed` | Development-only demo data (see below) |
| `npm test` | Full Vitest suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke` | End-to-end HTTP checks against a running server |
| `npm run screenshots` | Full-page PNGs of every page |
| `npm run verify` | typecheck → tests → build |

---

## Database

### Schema

```
users         id, email (unique, lowercase), name, password_hash, password_salt,
              created_at, updated_at

businesses    id, owner_user_id → users (cascade), name, slug (unique),
              tagline, logo_url, accent_color, created_at, updated_at
              unique(owner_user_id)  -- one business per account

testimonials  id, business_id → businesses (cascade), author_name, company,
              rating, content, status, source, ip_hash, user_agent,
              approved_at, created_at, updated_at

sessions      id, user_id → users (cascade), token_hash (unique),
              created_at, last_seen_at, expires_at

rate_limit_hits  bucket, key, created_at
```

Constraints enforced by Postgres, not only by the application:

- `rating BETWEEN 1 AND 5`
- `status IN ('pending','approved','rejected')`
- `char_length(content) BETWEEN 10 AND 1000`, name ≤ 60, company ≤ 80
- `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`, 3–40 characters
- `accent_color ~ '^#[0-9a-f]{6}$'`, `logo_url` empty or `http(s)://`
- `email = lower(email)`
- `updated_at` maintained by trigger

Indexes: `businesses(slug)`, `businesses(owner_user_id)`,
`testimonials(business_id, status, created_at DESC)`, `testimonials(business_id, created_at DESC)`,
`testimonials(business_id, created_at)`, `sessions(token_hash)`, `sessions(expires_at)`,
`sessions(user_id)`, `rate_limit_hits(bucket, key, created_at)`.

**Row level security is enabled on every table with no policies and no grants to `anon` or
`authenticated`.** The API connects as the table owner and is unaffected, but if a Supabase
publishable key ever leaked, PostgREST would deny every request by default. The API is the only
route to the data.

### Migrations

Versioned SQL lives in `supabase/migrations/`:

```
0001_initial.sql             tables, constraints, indexes, triggers, RLS lockdown
0002_rate_limiting.sql       rate_limit_hits + rate_limit_hit() function
0003_brand_accent_default.sql  brand accent default
0004_password_resets.sql     password reset tokens
0005_workspaces_projects.sql workspaces, members, projects; backfills every business
0006_saved_widgets.sql       widget public_id + status + created_by (saved-widget embeds)
```

Migrations `0005` and `0006` are purely additive: they create tables/columns and backfill, but
never drop or rewrite existing rows. `0005` gives every existing business a workspace, an owner
membership and a default project whose slug equals the business slug, so legacy `/t/:slug`,
`/wall/:slug` and embeds keep resolving. `0006` gives every widget a stable `public_id` (used by
embed snippets) and a `status` (`draft`/`live`/`archived`); pre-existing widgets become `live`.

```bash
npm run migrate
```

The runner:

- takes a Postgres **advisory lock**, so several instances booting at once cannot race;
- applies each file in its own transaction, so a failure leaves no partial schema;
- records a **checksum** per file and refuses to run if an applied migration was edited
  afterwards;
- is idempotent — already-applied files are skipped.

**Migrations are an administrative step and are never applied automatically.** Neither the
server nor the serverless function runs them: a schema change should not be a side effect of
starting an application, on serverless every cold start would race to apply it, and the
serverless bundle is not guaranteed to contain `supabase/migrations` at all. Run
`npm run migrate` as part of your deploy.

To make the trade-off safe, boot **verifies** the schema instead: it checks that every required
table exists and refuses to start with a clear message naming what is missing and pointing at
`npm run migrate`. That check queries the database, not the filesystem, so it works in a
serverless bundle.

To add a change, create the next numbered file; never edit an applied one.

---

## Architecture

```
src/
  shared/            Zod schemas + constants imported by BOTH runtimes
  server/
    config.js        environment parsing and validation (fails closed)
    db.js            pg pool, TLS resolution, advisory-locked migration runner
    access.js        role rules (owner/admin/manager/viewer, client scoping)
    workspaces.js    workspaces, clients, projects, team, access helpers
    widgets.js       saved widgets: list/create/update/duplicate/archive/public-by-id
    policies.js      legacy owner-only policy predicates
    repositories.js  all SQL; every scoped query is policy-checked
    auth.js          scrypt hashing, sessions, auth-gate middleware
    rateLimit.js     in-process + Postgres-backed limiters
    app.js           Express wiring, security headers, health, error handler
    routes/          auth · account · business · workspace · content · testimonials · public
  client/            React SPA
  widget/            standalone embed runtime (vanilla TS, no deps)
api/[...all].js      Vercel serverless adapter
supabase/migrations/ versioned SQL
```

Layering: **routes → access helpers → data layer → Postgres**. Controllers never build SQL and
the data layer never reads identity from the request. Agency routes authorise through
`requireClientAccess` / `requireProjectAccess` (workspace membership + client scope + role); a row
outside the caller's scope is a **404**, never a 403 that would leak its existence.

---

## Security model

- **Passwords** — scrypt with a 16-byte per-account salt; comparisons use `timingSafeEqual`.
  Login performs the same work for an unknown account as for a wrong password and returns one
  identical message.
- **Sessions** — a 32-byte random token in an `httpOnly`, `SameSite=Lax`, `Secure`-in-production
  cookie scoped to `/`. Only an HMAC-SHA256 of the token is stored, so a database dump cannot be
  replayed. Every login mints a new session row and cookie value, so a captured cookie can never
  be promoted to an authenticated session. Sign-out deletes the row; expiry is enforced both in
  the query and in the application.
- **Tenant isolation** — agency routes authorise through **workspace membership + client scope**
  (`requireClientAccess` / `requireProjectAccess`): the caller must belong to the workspace, the
  client must be inside their scope (owners/admins unscoped; managers/viewers limited to assigned
  clients), and writes require `canModerate`. The SQL is scoped independently. Identity is never
  read from the request body. A row the actor cannot touch returns **404, not 403**, so the API
  never confirms that another tenant's data exists.
- **Saved widgets** — the public by-id feed serves only widgets with `status = 'live'`; draft and
  archived widgets 404, so an unpublished widget can never appear on a customer's site. The feed
  returns the same approved-only testimonial projection as the wall, and sets
  `Access-Control-Allow-Origin: *` because it is fetched from third-party host pages.
- **Public surface** — an anonymous visitor can read approved testimonials for a slug and create
  one pending submission. Nothing else. Pending and rejected rows are filtered by Postgres.
- **Rate limiting** — login, signup and public submission counters live in Postgres, so they
  survive restarts and hold across instances. The general API bucket is in-process and best
  effort. The limiter fails open (with a warning) if the database is unreachable, because every
  protected route fails closed on its own database access.
- **Input** — every mutating route re-parses its body with the shared Zod schema, the JSON body
  limit is 64 kB, and a honeypot field silently discards bot submissions. Testimonial text is
  rendered through React's escaping; there is no `dangerouslySetInnerHTML` anywhere.
- **Errors and logs** — the client never receives a driver message, SQL fragment, stack trace,
  file path or credential. Postgres connection failures become `503 database_unavailable`; other
  server faults become a generic `500`. Logs carry a code and message, never a connection string,
  session token, cookie or password hash.
- **Database transport** — a remote database is always connected over TLS. An explicit
  `sslmode` wins (`verify-full` gets real chain verification); with no `sslmode`, any non-loopback
  host still gets TLS, because Supabase requires it and talking to a managed database in
  plaintext is not acceptable. Only loopback is allowed to be unencrypted.
- **Secrets** — `SUPABASE_DB_URL`, `SUPABASE_MIGRATION_DB_URL` and `SESSION_SECRET` exist only in
  the server environment. `describeConfig()` redacts all three if the environment is ever logged.

---

## Saved widgets

A saved widget is a project-scoped display configuration with a stable `public_id`, a `status`
(`draft` | `live` | `archived`) and an optional author. Unlike the legacy slug embed — which bakes
its options into `data-rw-*` attributes — a saved-widget embed references the widget by id, so
editing it in the dashboard updates every site that pasted the snippet.

```html
<script src="https://ravewall.vercel.app/widget/ravewall-widget.js" async></script>
<div data-ravewall-widget data-rw-widget="<public_id>"></div>
```

| Method & path | Purpose |
| --- | --- |
| `GET /api/projects/widgets` | Workspace-wide list (scoped to the caller's clients) |
| `GET /api/projects/widgets/:id` | One widget (editor load) |
| `POST /api/projects/projects/:projectId/widgets` | Create (defaults to `draft`) |
| `PATCH /api/projects/widgets/:id` | Partial update, including `status` |
| `POST /api/projects/widgets/:id/duplicate` | Copy into a new draft with a fresh public id |
| `DELETE /api/projects/widgets/:id` | Delete |
| `GET /api/public/widgets/:publicId` | **Public** feed; `live` only; approved-only testimonials |

The public feed applies the widget's `min_rating`, `tag_id` and `max_items`. Legacy embeds
(`data-rw-slug`) and `GET /api/public/widget/:slug` keep working unchanged.

---

## Deployment

### Option A — long-running Node service (recommended, fully verified)

Any host that runs a container or a Node process, including the platform this app is published
to. One port, one process, no serverless caveats.

```bash
npm ci
npm run build
npm start          # listens on $PORT, migrations run on boot
```

Set `NODE_ENV=production`, `SUPABASE_DB_URL`, `SESSION_SECRET`. Use the **direct** or
**session-pooler** connection string, and `PG_POOL_MAX=5`–`10`.

### Option B — Vercel

`vercel.json` and `api/[...all].js` are included: the SPA is served statically from `dist/`, and
every `/api/**` request is handled by one Express function that reuses its pool across warm
invocations.

1. Import the repository into Vercel.
2. Add these environment variables (see "What the runtime needs" below):
   - `SUPABASE_DB_URL` — the **transaction pooler** URI (port `6543`) — **required**
   - `SESSION_SECRET` — **required**
   - `PG_POOL_MAX=2` — recommended, so concurrent instances do not exhaust the pooler
3. Deploy.

`SUPABASE_MIGRATION_DB_URL` is deliberately **not** set here. The deployed runtime never
migrates, so exposing the session-pooler credential to it would be unnecessary blast radius. Run
`npm run migrate` from a machine that holds it.

```bash
npm run migrate        # locally, over the session pooler, before or after deploying
```

### What the runtime needs

| Variable | Runtime | Why |
| --- | --- | --- |
| `SUPABASE_DB_URL` | **required** | Every request reads and writes through it. |
| `SESSION_SECRET` | **required** | Peppers the session-token HMAC. Without it the app refuses to boot. |
| `NODE_ENV` | auto | Vercel sets `production`; that is what turns on `Secure` cookies. |
| `PG_POOL_MAX` | recommended | Defaults to 5 in production; use 1–3 on serverless. |
| `SUPABASE_MIGRATION_DB_URL` | **not needed** | Only `npm run migrate` and `npm run verify:deployment` read it. |
| `APP_URL` | **not needed** | See below. |
| `ALLOWED_ORIGINS` | not needed | Same-origin is allowed automatically. |
| `TRUST_PROXY` | not needed | Defaults to on, which is correct behind Vercel's proxy. |
| `PORT`, `HOST` | not needed | The platform provides them. |
| Rate limits, quota | not needed | Safe defaults are built in. |

**`APP_URL` is optional metadata, not a requirement.** Nothing depends on it:

- **Origin protection** derives same-origin from the request's `Host` header plus
  `ALLOWED_ORIGINS`, so it works on any domain including preview deployments.
- **Cookies** are host-only (`path: /`, no `domain`), so no absolute URL is involved.
- **Redirects** — there are none; routing is client-side.
- **Public links** are built in the browser from `window.location.origin`, which is why the
  collection link and wall are correct on whatever host serves the app.

### After deploying

```bash
curl -s https://your-app/api/health     # {"data":{"status":"ok","database":"ok",...}}
npm run verify:deployment               # schema, indexes, functions, RLS on the live database
PORT=3999 npm run smoke                 # end-to-end checks (needs a clear rate-limit window)
```

Checklist: signup → business setup → copy the collection link → submit a testimonial as a
visitor → confirm it is absent from the wall → approve it → confirm it appears.

---

## Demo data (development only)

```bash
npm run seed
```

Creates `demo@kudos.test` / `Passw0rd!` with a "Northwind Studio" workspace and eight
testimonials (five approved, two pending, one rejected). It is idempotent per entry, so
re-running tops up whatever is missing.

**This must never run in production.** It is a manual command — there is no install or start
hook — and it refuses to run against a server that reports itself as production unless
`ALLOW_DEMO_SEED=1` is set explicitly. A production database starts clean.

---

## Tests

```bash
npm test                                  # 377 tests across 30 files
PORT=3999 npm run smoke                   # 52 end-to-end HTTP checks
```

Tests run against a **real PostgreSQL** (PGlite, in-process) with the real migrations, so
constraints, `FILTER` aggregates and plpgsql functions are genuinely exercised. No external
service or credentials are needed. Spawned-process tests set `ENV_FILE` to a path that does not
exist, so a suite run can never read the developer's `.env` or reach the live database it points
at.

`npm run smoke` drives a running server over HTTP, so it needs one to talk to. It also needs the
rate-limit window to be clear: the submission and auth counters live in Postgres and survive a
restart. For a local run, start an in-memory instance — clean schema *and* clean window:

```bash
PGLITE_DIR=memory PORT=3999 node scripts/dev-server.mjs    # terminal 1
PORT=3999 npm run smoke                                    # terminal 2
```

The script detects an exhausted window, says so, and exits `2` rather than reporting misleading
failures.

| Suite | Covers |
| --- | --- |
| `validation.test.js` | Slug normalisation, reserved names, password rules, colour/URL validation, rating bounds |
| `config.test.js` | Fail-closed environment validation, defaults, secret redaction |
| `env-file.test.js` | `.env` parsing, and the rule that a real environment variable always wins |
| `serverless.test.js` | The Vercel adapter: forwarding, warm-instance caching, 503 on a failed cold start |
| `db.test.js` | Migration idempotency, checksum drift, rollback on failure, every constraint, cascades, RLS, TLS resolution |
| `policies.test.js` | Read/write policy truth table, cross-tenant denial, spoofed rows |
| `repositories.test.js` | SQL behaviour: scoping, search, sorting, aggregates, `approved_at`, tenant 404s, the Postgres rate limiter |
| `rateLimit.test.js` | Sliding-window semantics, key isolation, bucket sweeping |
| `api.auth.test.js` | Signup/login/logout, hashing, session integrity, gates, security headers |
| `api.testimonials.test.js` | Full moderation flow, wall visibility, search/sort, quotas |
| `workspace.test.js` | Workspace bootstrap, client/project lifecycle, tenant isolation, agency roles, self-escalation guards |
| `content.test.js` | Tags, custom questions, saved widgets, project/workspace analytics, CSV export/import |
| `account.test.js` | Profile/email, password change ends other sessions, session revocation, account deletion guards |
| `widgets.test.js` | Saved-widget CRUD, partial update, duplicate, archive, public by-id feed (status gating, rating/tag filters), cross-tenant isolation, manager/viewer/admin widget + moderation roles, per-client/project summaries |
| `security.test.js` | The launch acceptance matrix: tenant isolation, anonymous reach, input hardening, visibility, secret handling |
| `startup.test.js` | The process refuses to boot without a database or session secret |
| `seed-guard.test.js` | The demo seeder refuses to touch a production server |
| `client/*.test.tsx` | Stars, collection form, business form, API client |

The suite fails if a file collects no tests.

---

## Operations

- **Health:** `GET /api/health` → `200` with `{status:"ok", database:"ok"}`, or `503` with
  `{status:"degraded", database:"unavailable"}`. No driver detail is exposed.
- **Logging:** server start, database connection failure, migration application, health failures,
  rate-limiter unavailability, unexpected request errors, graceful shutdown.
- **Shutdown:** `SIGTERM`/`SIGINT` stop accepting connections, close the pool, then exit.
- **Background sweep:** expired sessions and stale rate-limit rows are pruned hourly.
- **Persistence:** the API holds no local state, so it can be restarted, redeployed or scaled
  freely.

### Troubleshooting

**`Cannot find module @rollup/rollup-win32-x64-msvc` (or `@esbuild/...`) after `npm install`.**
A known npm optional-dependency bug on Windows. Reinstall the platform package at the version
already in `node_modules`:

```bash
npm install --no-save "@rollup/rollup-win32-x64-msvc@$(node -p "require('./node_modules/rollup/package.json').version")" \
                        "@esbuild/win32-x64@$(node -p "require('./node_modules/esbuild/package.json').version")"
```

**`Invalid environment configuration` on boot.** Working as intended — a required variable is
missing. The message names every one.

**`password authentication failed for user "postgres"`.** The connection string is being parsed
correctly (the username `postgres.<project-ref>` and the port are right), so the password itself
is wrong. The most common cause is the Supabase dashboard's template:
`postgresql://postgres.[ref]:[YOUR-PASSWORD]@...`. If you select the text and type over it, an
editor may leave the square brackets in place, so the password becomes `[yourpassword]` — which
looks plausible but is rejected. Check that `SUPABASE_DB_URL` and `SUPABASE_MIGRATION_DB_URL`
carry the *same* password, and that neither is wrapped in `[ ]`. To confirm which of two
candidate strings is correct without printing either:

```bash
node -e "
const pg = require('pg');
new pg.Client({ connectionString: process.env.SUPABASE_MIGRATION_DB_URL })
  .connect().then(c => c.query('select current_user').then(r => { console.log('OK', r.rows[0]); c.end() }))
  .catch(e => console.log('FAIL', e.code, e.message))
"
```
