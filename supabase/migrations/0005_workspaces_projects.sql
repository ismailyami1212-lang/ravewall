-- ===========================================================================
-- RaveWall — workspaces, clients, projects, team roles
--
-- Additive evolution of the one-business-per-account model:
--
--   users → workspaces → businesses (clients) → projects → testimonials
--
-- Nothing is dropped or rewritten except the single-owner constraint on
-- businesses, which is replaced by workspace membership. Every existing
-- business is backfilled with a workspace, an owner membership and a default
-- project whose slug equals the business slug — so every existing
-- /t/:slug, /wall/:slug and embed keeps working untouched.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- workspaces
-- --------------------------------------------------------------------------
CREATE TABLE workspaces (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  plan       text        NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT workspaces_plan_valid CHECK (plan IN ('free', 'starter', 'pro', 'agency'))
);

COMMENT ON TABLE workspaces IS
  'Billing and membership boundary. A solo business has one workspace; an agency has one workspace with many clients.';

CREATE TRIGGER workspaces_set_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------------------------
-- workspace_members — who can see a workspace, and with what role
-- --------------------------------------------------------------------------
CREATE TABLE workspace_members (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         text        NOT NULL DEFAULT 'owner',
  status       text        NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_members_role_valid CHECK (role IN ('owner', 'admin', 'manager', 'viewer')),
  CONSTRAINT workspace_members_status_valid CHECK (status IN ('active', 'invited')),
  CONSTRAINT workspace_members_unique UNIQUE (workspace_id, user_id)
);

COMMENT ON TABLE workspace_members IS
  'Membership + role. An invited row becomes active when that email signs up.';

CREATE INDEX workspace_members_user_idx ON workspace_members (user_id);
CREATE INDEX workspace_members_workspace_idx ON workspace_members (workspace_id);

-- Optional per-member client assignment. A manager with no rows here sees
-- nothing; a manager with rows sees exactly those clients.
CREATE TABLE workspace_member_clients (
  member_id   uuid NOT NULL REFERENCES workspace_members (id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  PRIMARY KEY (member_id, business_id)
);

COMMENT ON TABLE workspace_member_clients IS
  'Client scope for manager/viewer roles. Owners and admins are unscoped.';

-- --------------------------------------------------------------------------
-- businesses gain a workspace; the single-owner restriction is removed
-- --------------------------------------------------------------------------
ALTER TABLE businesses ADD COLUMN workspace_id uuid REFERENCES workspaces (id) ON DELETE CASCADE;

DO $$
DECLARE
  b  RECORD;
  ws uuid;
BEGIN
  FOR b IN SELECT * FROM businesses ORDER BY created_at LOOP
    INSERT INTO workspaces (name, created_at) VALUES (b.name, b.created_at) RETURNING id INTO ws;
    INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
      VALUES (ws, b.owner_user_id, 'owner', b.created_at);
    UPDATE businesses SET workspace_id = ws WHERE id = b.id;
  END LOOP;
END;
$$;

ALTER TABLE businesses ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_owner_unique;
CREATE INDEX businesses_workspace_idx ON businesses (workspace_id);

-- --------------------------------------------------------------------------
-- projects — a client can have several testimonial projects
-- --------------------------------------------------------------------------
CREATE TABLE projects (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  business_id  uuid        NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  slug         text        NOT NULL,
  is_default   boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT projects_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT projects_slug_length CHECK (char_length(slug) BETWEEN 3 AND 60),
  CONSTRAINT projects_slug_unique UNIQUE (slug)
);

COMMENT ON TABLE projects IS
  'A testimonial project. The default project of a client reuses the client slug so legacy /t/:slug links resolve.';

CREATE INDEX projects_business_idx ON projects (business_id);
CREATE INDEX projects_workspace_idx ON projects (workspace_id);

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE
  b  RECORD;
BEGIN
  FOR b IN SELECT * FROM businesses ORDER BY created_at LOOP
    IF NOT EXISTS (SELECT 1 FROM projects WHERE business_id = b.id) THEN
      INSERT INTO projects (workspace_id, business_id, name, slug, is_default, created_at)
        VALUES (b.workspace_id, b.id, b.name, b.slug, true, b.created_at);
    END IF;
  END LOOP;
END;
$$;

-- --------------------------------------------------------------------------
-- testimonials gain a project (business_id is kept as the denormalised owner)
-- --------------------------------------------------------------------------
ALTER TABLE testimonials ADD COLUMN project_id uuid REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE testimonials ADD COLUMN answers jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE testimonials t
   SET project_id = p.id
  FROM projects p
 WHERE p.business_id = t.business_id
   AND p.is_default
   AND t.project_id IS NULL;

ALTER TABLE testimonials ALTER COLUMN project_id SET NOT NULL;
CREATE INDEX testimonials_project_status_created_idx
  ON testimonials (project_id, status, created_at DESC);
CREATE INDEX testimonials_project_created_idx ON testimonials (project_id, created_at DESC);

-- --------------------------------------------------------------------------
-- custom questions per project
-- --------------------------------------------------------------------------
CREATE TABLE custom_questions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  label      text        NOT NULL,
  type       text        NOT NULL DEFAULT 'short',
  required   boolean     NOT NULL DEFAULT false,
  position   integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_questions_label_length CHECK (char_length(label) BETWEEN 1 AND 120),
  CONSTRAINT custom_questions_type_valid CHECK (type IN ('short', 'long', 'rating', 'company'))
);

COMMENT ON TABLE custom_questions IS
  'Extra fields asked on the public collection form. Answers live in testimonials.answers (jsonb).';

CREATE INDEX custom_questions_project_idx ON custom_questions (project_id, position);

-- --------------------------------------------------------------------------
-- tags
-- --------------------------------------------------------------------------
CREATE TABLE tags (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_name_length CHECK (char_length(name) BETWEEN 1 AND 40),
  CONSTRAINT tags_workspace_name_unique UNIQUE (workspace_id, name)
);

CREATE INDEX tags_workspace_idx ON tags (workspace_id);

CREATE TABLE testimonial_tags (
  testimonial_id uuid NOT NULL REFERENCES testimonials (id) ON DELETE CASCADE,
  tag_id         uuid NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (testimonial_id, tag_id)
);

CREATE INDEX testimonial_tags_tag_idx ON testimonial_tags (tag_id);

-- --------------------------------------------------------------------------
-- saved widget configurations
--
-- A saved config is a stored set of the same data-rw-* attributes the embed
-- already uses, so existing embeds and the widget runtime are unaffected.
-- --------------------------------------------------------------------------
CREATE TABLE widget_configs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name        text        NOT NULL,
  layout      text        NOT NULL DEFAULT 'grid',
  theme       text        NOT NULL DEFAULT 'light',
  accent      text        NOT NULL DEFAULT '#15803d',
  show_stars  boolean     NOT NULL DEFAULT true,
  show_company boolean    NOT NULL DEFAULT true,
  max_items   smallint    NOT NULL DEFAULT 9,
  min_rating  smallint,
  tag_id      uuid        REFERENCES tags (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT widget_configs_name_length CHECK (char_length(name) BETWEEN 1 AND 60),
  CONSTRAINT widget_configs_layout_valid CHECK (layout IN ('grid', 'carousel', 'single', 'compact')),
  CONSTRAINT widget_configs_theme_valid CHECK (theme IN ('light', 'dark')),
  CONSTRAINT widget_configs_accent_format CHECK (accent ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT widget_configs_max_items_range CHECK (max_items BETWEEN 1 AND 50),
  CONSTRAINT widget_configs_min_rating_range CHECK (min_rating IS NULL OR min_rating BETWEEN 1 AND 5)
);

CREATE INDEX widget_configs_project_idx ON widget_configs (project_id);

CREATE TRIGGER widget_configs_set_updated_at
  BEFORE UPDATE ON widget_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------------------------
-- Defence in depth: RLS on, no grants to the anon/authenticated roles
-- --------------------------------------------------------------------------
ALTER TABLE workspaces              ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_member_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects                ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_questions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonial_tags        ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_configs          ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.workspaces,
                       public.workspace_members,
                       public.workspace_member_clients,
                       public.projects,
                       public.custom_questions,
                       public.tags,
                       public.testimonial_tags,
                       public.widget_configs
      FROM anon, authenticated;
  END IF;
END;
$$;
