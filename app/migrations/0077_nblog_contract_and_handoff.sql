-- Issue #18: shared operations contract, immutable approvals, one-time browser handoff.

ALTER TABLE nblog_campaigns
  ADD COLUMN contract_version TEXT NOT NULL DEFAULT '1.0';

ALTER TABLE nblog_campaigns
  ADD COLUMN operation_status TEXT NOT NULL DEFAULT 'local_ready'
    CHECK (operation_status IN (
      'local_ready', 'syncing', 'synced', 'validation_failed',
      'approval_waiting', 'approved_for_handoff', 'handoff_ready',
      'browser_connected', 'input_in_progress', 'user_action_required',
      'review_required', 'draft_saved', 'publishing', 'published',
      'publish_result_unknown', 'failed'
    ));

UPDATE nblog_campaigns
SET operation_status = CASE status
  WHEN 'analysis' THEN 'syncing'
  WHEN 'validation' THEN 'syncing'
  WHEN 'approval' THEN 'approval_waiting'
  WHEN 'scheduled' THEN 'approved_for_handoff'
  WHEN 'handoff' THEN 'user_action_required'
  WHEN 'published' THEN 'published'
  WHEN 'failed' THEN 'failed'
  ELSE 'local_ready'
END;

CREATE INDEX IF NOT EXISTS idx_nblog_campaigns_operation_queue
  ON nblog_campaigns (user_id, operation_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS nblog_approvals (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  campaign_id           TEXT NOT NULL,
  artifact_version      INTEGER NOT NULL,
  requirement_version   TEXT,
  draft_version         TEXT,
  validation_version    TEXT,
  profile_version       TEXT,
  approved_by           TEXT NOT NULL,
  approved_at           TEXT NOT NULL,
  confirmation_json     TEXT NOT NULL DEFAULT '{}',
  UNIQUE (user_id, campaign_id, artifact_version)
);

CREATE INDEX IF NOT EXISTS idx_nblog_approvals_campaign
  ON nblog_approvals (user_id, campaign_id, approved_at DESC);

CREATE TABLE IF NOT EXISTS nblog_handoff_sessions (
  id                    TEXT PRIMARY KEY,
  token_hash            TEXT NOT NULL UNIQUE,
  user_id               TEXT NOT NULL,
  campaign_id           TEXT NOT NULL,
  artifact_version      INTEGER NOT NULL,
  requirement_version   TEXT,
  draft_version         TEXT,
  validation_version    TEXT,
  profile_version       TEXT,
  contract_version      TEXT NOT NULL DEFAULT '1.0',
  status                TEXT NOT NULL DEFAULT 'handoff_ready'
                          CHECK (status IN (
                            'handoff_ready', 'browser_connected', 'input_in_progress',
                            'user_action_required', 'review_required', 'draft_saved',
                            'publishing', 'published', 'publish_result_unknown',
                            'failed', 'expired', 'cancelled'
                          )),
  allowed_actions_json  TEXT NOT NULL DEFAULT '[]',
  expires_at            TEXT NOT NULL,
  used_at               TEXT,
  cancelled_at          TEXT,
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nblog_handoff_sessions_campaign
  ON nblog_handoff_sessions (user_id, campaign_id, status, expires_at DESC);

CREATE TABLE IF NOT EXISTS nblog_idempotency_records (
  user_id          TEXT NOT NULL,
  scope            TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  request_hash     TEXT NOT NULL,
  response_json    TEXT NOT NULL,
  status_code      INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  PRIMARY KEY (user_id, scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_nblog_idempotency_expiry
  ON nblog_idempotency_records (expires_at);
