-- ===========================================================================
-- Kudos — initial schema
--
-- Applied by `npm run migrate` (src/server/db.js) inside a single transaction.
-- Never edit an applied migration; add a new numbered file instead.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Shared helper: keep updated_at honest on every UPDATE.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------------
-- users
-- --------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL,
  name          text        NOT NULL,
  password_hash text        NOT NULL,
  password_salt text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT users_name_length CHECK (char_length(name) BETWEEN 1 AND 60),
  CONSTRAINT users_email_unique UNIQUE (email)
);

COMMENT ON TABLE users IS 'Kudos account owners. Passwords are scrypt hashes, never plaintext.';

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------------------------
-- businesses — one per account (unique owner_user_id)
-- --------------------------------------------------------------------------
CREATE TABLE businesses (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name          text        NOT NULL,
  slug          text        NOT NULL,
  tagline       text        NOT NULL DEFAULT '',
  logo_url      text        NOT NULL DEFAULT '',
  accent_color  text        NOT NULL DEFAULT '#4f46e5',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT businesses_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT businesses_slug_length CHECK (char_length(slug) BETWEEN 3 AND 40),
  -- Mirrors the Zod rule so a malformed slug can never reach the table.
  CONSTRAINT businesses_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT businesses_accent_color_format CHECK (accent_color ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT businesses_logo_url_format CHECK (logo_url = '' OR logo_url ~* '^https?://'),
  CONSTRAINT businesses_slug_unique UNIQUE (slug),
  CONSTRAINT businesses_owner_unique UNIQUE (owner_user_id)
);

COMMENT ON TABLE businesses IS 'One business profile per account; slug is the public collection link.';

CREATE INDEX businesses_slug_idx ON businesses (slug);
CREATE INDEX businesses_owner_idx ON businesses (owner_user_id);

CREATE TRIGGER businesses_set_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------------------------
-- testimonials
-- --------------------------------------------------------------------------
CREATE TABLE testimonials (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid        NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  author_name text        NOT NULL,
  company     text        NOT NULL DEFAULT '',
  rating      smallint    NOT NULL,
  content     text        NOT NULL,
  status      text        NOT NULL DEFAULT 'pending',
  source      text        NOT NULL DEFAULT 'link',
  ip_hash     text,
  user_agent  text,
  approved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT testimonials_rating_range CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT testimonials_status_valid CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT testimonials_author_name_length CHECK (char_length(author_name) BETWEEN 1 AND 60),
  CONSTRAINT testimonials_company_length CHECK (char_length(company) <= 80),
  CONSTRAINT testimonials_content_length CHECK (char_length(content) BETWEEN 10 AND 1000)
);

COMMENT ON TABLE testimonials IS
  'Customer submissions. New rows are always pending; only approved rows are public.';

-- Moderation queue: filter by status, newest first.
CREATE INDEX testimonials_business_status_created_idx
  ON testimonials (business_id, status, created_at DESC);
-- Public wall: approved rows only, newest first.
CREATE INDEX testimonials_business_created_idx
  ON testimonials (business_id, created_at DESC);
-- Rolling submission quota.
CREATE INDEX testimonials_business_created_at_idx
  ON testimonials (business_id, created_at);

CREATE TRIGGER testimonials_set_updated_at
  BEFORE UPDATE ON testimonials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------------------------
-- sessions — server-side session records.
-- Only an HMAC of the cookie value is stored, so the table cannot be replayed.
-- --------------------------------------------------------------------------
CREATE TABLE sessions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  CONSTRAINT sessions_token_hash_unique UNIQUE (token_hash)
);

COMMENT ON TABLE sessions IS 'Server-side sessions. Stores an HMAC of the cookie token, never the token.';

CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- ===========================================================================
-- Defence in depth
--
-- The API is the only database client and connects as the table owner, so these
-- tables are never reachable from the browser. Supabase still publishes the
-- `public` schema through PostgREST to the `anon` / `authenticated` roles, so we
-- turn RLS on and grant those roles nothing: if a publishable key ever leaked,
-- every request would be denied by default.
-- ===========================================================================
ALTER TABLE users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions     ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.users, public.businesses, public.testimonials, public.sessions
      FROM anon, authenticated;
  END IF;
END;
$$;
