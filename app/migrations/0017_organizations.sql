CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_members (
  org_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id),
  CHECK (role IN ('admin', 'member')),
  CHECK (status IN ('active', 'removed'))
);

CREATE INDEX IF NOT EXISTS idx_org_members_user
  ON organization_members (user_id, status);

CREATE TABLE IF NOT EXISTS organization_invites (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',
  token       TEXT NOT NULL UNIQUE,
  invited_by  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL,
  accepted_at TEXT,
  CHECK (role IN ('admin', 'member')),
  CHECK (status IN ('pending', 'accepted', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_org_invites_org_status
  ON organization_invites (org_id, status);

CREATE INDEX IF NOT EXISTS idx_org_invites_email_status
  ON organization_invites (email, status);
