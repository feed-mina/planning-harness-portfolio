-- Issue #71: track runner failures explicitly and make queued build polling efficient.

ALTER TABLE garden_builds ADD COLUMN error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_garden_builds_status_started
  ON garden_builds (status, started_at);
