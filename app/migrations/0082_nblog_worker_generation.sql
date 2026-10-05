-- Issue #24: Worker-side generation and immutable user content confirmation.

ALTER TABLE nblog_campaigns
  ADD COLUMN generation_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (generation_status IN (
      'not_started', 'generating', 'generation_failed',
      'awaiting_content_review', 'content_confirmed'
    ));

ALTER TABLE nblog_campaigns ADD COLUMN generation_input_hash TEXT;
ALTER TABLE nblog_campaigns ADD COLUMN content_confirmed_at TEXT;
ALTER TABLE nblog_campaigns ADD COLUMN content_confirmed_by TEXT;
ALTER TABLE nblog_campaigns ADD COLUMN content_confirmed_artifact_version INTEGER;

CREATE INDEX IF NOT EXISTS idx_nblog_campaigns_generation_queue
  ON nblog_campaigns (user_id, generation_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS nblog_generation_runs (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  campaign_id       TEXT NOT NULL,
  input_hash        TEXT NOT NULL,
  workflow_id       TEXT,
  status            TEXT NOT NULL DEFAULT 'generating'
                      CHECK (status IN ('generating', 'completed', 'failed')),
  error_code        TEXT,
  error_message     TEXT,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  completed_at      TEXT,
  UNIQUE (user_id, campaign_id, input_hash)
);

CREATE TABLE IF NOT EXISTS nblog_content_confirmations (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  campaign_id       TEXT NOT NULL,
  artifact_version  INTEGER NOT NULL,
  input_hash        TEXT NOT NULL,
  confirmed_by      TEXT NOT NULL,
  confirmed_at      TEXT NOT NULL,
  confirmation_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (user_id, campaign_id, artifact_version)
);
