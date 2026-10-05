CREATE TABLE IF NOT EXISTS garden_site_cleanup_jobs (
  id TEXT PRIMARY KEY,
  garden_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  deploy_target TEXT NOT NULL,
  site_url TEXT,
  project_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  cleanup_due_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_garden_site_cleanup_due
  ON garden_site_cleanup_jobs (status, cleanup_due_at);
