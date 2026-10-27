-- ===========================================================================
-- RaveWall — Stripe billing identifiers
--
-- Adds the minimum durable state needed to reconcile subscriptions:
--
--   stripe_customer_id     — the Stripe Customer for this workspace
--   stripe_subscription_id — the current/last Stripe Subscription
--   subscription_status    — the last status Stripe reported
--
-- `workspaces.plan` remains the single entitlement authority. Webhooks update
-- it only after signature verification; checkout never writes a plan directly.
--
-- Purely additive. Existing workspaces keep `plan = 'free'` and have no Stripe
-- identifiers until they start a checkout.
-- ===========================================================================

ALTER TABLE workspaces
  ADD COLUMN stripe_customer_id     text,
  ADD COLUMN stripe_subscription_id text,
  ADD COLUMN subscription_status    text;

COMMENT ON COLUMN workspaces.stripe_customer_id IS
  'Stripe Customer id. Unique so one customer can never span two tenants.';
COMMENT ON COLUMN workspaces.stripe_subscription_id IS
  'Current or most recent Stripe Subscription id. Kept after cancellation for audit.';
COMMENT ON COLUMN workspaces.subscription_status IS
  'Last status reported by Stripe (active, trialing, past_due, canceled, …).';

-- Partial indexes permit the many NULLs every free workspace has while still
-- enforcing that a Stripe reference belongs to exactly one workspace.
CREATE UNIQUE INDEX workspaces_stripe_customer_unique
  ON workspaces (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX workspaces_stripe_subscription_unique
  ON workspaces (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
