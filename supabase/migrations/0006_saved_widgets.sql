-- ===========================================================================
-- RaveWall — saved widgets become first-class entities
--
-- 0005 introduced `widget_configs` as a stored preset per project. This
-- migration makes a saved widget something an embed can point at directly:
--
--   * public_id — a stable, opaque identifier used in embed snippets
--                 (`<div data-ravewall-widget data-rw-widget="…">`). Editing a
--                 widget updates every embed that references it, with no need
--                 to re-paste code.
--   * status    — 'draft' | 'live' | 'archived'. Only 'live' widgets are served
--                 by the public by-id feed. Existing rows were usable presets,
--                 so they default to 'live' (behaviour preserved).
--   * created_by — authorship for the widget list ("Created by …").
--
-- Purely additive: no rows are deleted or rewritten, and the legacy slug-based
-- `/api/public/widget/:slug` endpoint and existing `data-rw-slug` embeds are
-- untouched.
-- ===========================================================================

-- Stable public identifier. Backfilled deterministically for existing rows,
-- then made required with a volatile default for future inserts.
ALTER TABLE widget_configs ADD COLUMN public_id text;
UPDATE widget_configs
   SET public_id = substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)
 WHERE public_id IS NULL;
ALTER TABLE widget_configs ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE widget_configs
  ALTER COLUMN public_id SET DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);

ALTER TABLE widget_configs
  ADD CONSTRAINT widget_configs_public_id_unique UNIQUE (public_id);

-- Publication state. Existing presets were live, so keep that behaviour.
ALTER TABLE widget_configs
  ADD COLUMN status text NOT NULL DEFAULT 'live';

ALTER TABLE widget_configs
  ADD CONSTRAINT widget_configs_status_valid CHECK (status IN ('draft', 'live', 'archived'));

-- Authorship (nullable: rows created before this migration have no author).
ALTER TABLE widget_configs
  ADD COLUMN created_by uuid REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX widget_configs_project_status_idx ON widget_configs (project_id, status);
