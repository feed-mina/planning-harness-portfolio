-- Per-user persistence for the Studio editor's saved manifests and releases.
CREATE TABLE IF NOT EXISTS studio_projects (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS studio_project_versions (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  label TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (user_id, project_id, version)
);

CREATE TABLE IF NOT EXISTS studio_releases (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  release_version INTEGER NOT NULL,
  manifest_version INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  published_by TEXT NOT NULL,
  PRIMARY KEY (user_id, project_id, page_id, slug, release_version)
);
