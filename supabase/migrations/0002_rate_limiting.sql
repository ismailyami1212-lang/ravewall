-- ===========================================================================
-- Kudos — distributed rate limiting
--
-- The in-process limiter is per instance: a restart or a second instance resets
-- it. Login, signup and public submission are the endpoints worth protecting, so
-- their counters live in Postgres instead. The general API bucket stays
-- in-process (cheap, best effort) — see src/server/rateLimit.js.
-- ===========================================================================

CREATE TABLE rate_limit_hits (
  bucket     text        NOT NULL,
  key        text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE rate_limit_hits IS
  'Sliding-window rate limit counters. One row per recorded hit; expired rows are pruned by the limiter.';

CREATE INDEX rate_limit_hits_lookup_idx ON rate_limit_hits (bucket, key, created_at);

ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.rate_limit_hits FROM anon, authenticated;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- rate_limit_hit — record one hit and report whether it is allowed.
--
-- One round trip, atomic with respect to the caller's transaction. Two
-- concurrent callers can both observe a count of max-1 and both be allowed, so
-- the effective ceiling is "max plus a small race window" — acceptable for
-- abuse control, and deliberately not treated as a security boundary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rate_limit_hit(
  p_bucket    text,
  p_key       text,
  p_window_ms integer,
  p_max       integer
)
RETURNS TABLE (allowed boolean, remaining integer, retry_after_ms integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_window interval;
  v_cutoff timestamptz;
  v_hits   integer;
  v_oldest timestamptz;
BEGIN
  IF p_max <= 0 THEN
    RETURN QUERY SELECT false, 0, p_window_ms;
    RETURN;
  END IF;

  v_window := make_interval(secs => (p_window_ms::double precision) / 1000.0);
  v_cutoff := now() - v_window;

  -- Drop this key's expired hits so the table stays proportional to traffic.
  DELETE FROM rate_limit_hits
   WHERE bucket = p_bucket
     AND key = p_key
     AND created_at <= v_cutoff;

  SELECT count(*)::integer, min(created_at)
    INTO v_hits, v_oldest
    FROM rate_limit_hits
   WHERE bucket = p_bucket
     AND key = p_key;

  IF v_hits >= p_max THEN
    RETURN QUERY SELECT
      false,
      0,
      GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM (v_oldest + v_window - now())) * 1000)::integer
      );
    RETURN;
  END IF;

  INSERT INTO rate_limit_hits (bucket, key, created_at) VALUES (p_bucket, p_key, now());

  RETURN QUERY SELECT true, GREATEST(0, p_max - v_hits - 1), 0;
END;
$$;

COMMENT ON FUNCTION rate_limit_hit(text, text, integer, integer) IS
  'Records a hit for (bucket, key) and returns whether it is within the sliding window.';
