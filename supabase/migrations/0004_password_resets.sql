-- ===========================================================================
-- RaveWall — password resets
--
-- Additive and non-destructive: a new table only, no existing column or row
-- is touched. Only an HMAC of a reset token is stored, so a database dump
-- cannot be used to reset anyone's password. Tokens are single-use
-- (`used_at`) and expire (`expires_at`).
-- ===========================================================================

CREATE TABLE password_resets (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  CONSTRAINT password_resets_token_hash_unique UNIQUE (token_hash)
);

COMMENT ON TABLE password_resets IS
  'Single-use, expiring password reset tokens. Stores an HMAC of the token, never the token itself.';

CREATE INDEX password_resets_user_id_idx ON password_resets (user_id);
CREATE INDEX password_resets_expires_at_idx ON password_resets (expires_at);

ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.password_resets FROM anon, authenticated;
  END IF;
END;
$$;
