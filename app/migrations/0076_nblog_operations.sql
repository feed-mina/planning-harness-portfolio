-- NBlog 로컬 산출물 동기화, 운영 상태, 수동 인계와 발행 감사 이력.

CREATE TABLE IF NOT EXISTS nblog_campaigns (
  user_id                 TEXT NOT NULL,
  campaign_id             TEXT NOT NULL,
  campaign_name           TEXT NOT NULL,
  campaign_url            TEXT NOT NULL,
  place_url               TEXT NOT NULL,
  visit_date              TEXT NOT NULL,
  visit_notes             TEXT NOT NULL DEFAULT '',
  tone_profile            TEXT NOT NULL DEFAULT '',
  user_tags_json          TEXT NOT NULL DEFAULT '[]',
  prompt_profile_id       TEXT,
  prompt_override         TEXT,
  prompt_snapshot_hash    TEXT,
  source_folder           TEXT,
  blog_url                TEXT,
  category                TEXT,
  status                  TEXT NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'analysis', 'validation', 'approval', 'scheduled', 'published', 'failed', 'handoff')),
  validation_passed       INTEGER NOT NULL DEFAULT 0 CHECK (validation_passed IN (0, 1)),
  approved_at             TEXT,
  approved_by             TEXT,
  scheduled_at            TEXT,
  published_url           TEXT,
  published_at            TEXT,
  confirmed_by            TEXT,
  requirement_version     TEXT,
  draft_version           TEXT,
  validation_version      TEXT,
  profile_version         TEXT,
  artifact_version        INTEGER NOT NULL DEFAULT 0,
  artifact_content_hash   TEXT,
  last_sync_at            TEXT,
  failure_stage           TEXT,
  failure_reason          TEXT,
  resume_stage            TEXT,
  resume_point            TEXT,
  remaining_steps_json    TEXT NOT NULL DEFAULT '[]',
  last_checkpoint_at      TEXT,
  retry_count             INTEGER NOT NULL DEFAULT 0,
  retry_limit             INTEGER NOT NULL DEFAULT 3,
  retryable               INTEGER NOT NULL DEFAULT 1 CHECK (retryable IN (0, 1)),
  workflow_instance_id    TEXT,
  version                 INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  PRIMARY KEY (user_id, campaign_id),
  UNIQUE (user_id, campaign_id, visit_date)
);

CREATE INDEX IF NOT EXISTS idx_nblog_campaigns_queue
  ON nblog_campaigns (user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS nblog_artifact_versions (
  user_id              TEXT NOT NULL,
  campaign_id          TEXT NOT NULL,
  artifact_version     INTEGER NOT NULL,
  schema_version       TEXT NOT NULL,
  content_hash         TEXT NOT NULL,
  idempotency_key      TEXT NOT NULL,
  object_keys_json     TEXT NOT NULL,
  requirement_version  TEXT,
  draft_version        TEXT,
  validation_version   TEXT,
  profile_version      TEXT,
  validation_passed    INTEGER NOT NULL CHECK (validation_passed IN (0, 1)),
  created_at           TEXT NOT NULL,
  created_by           TEXT NOT NULL,
  PRIMARY KEY (user_id, campaign_id, artifact_version),
  UNIQUE (user_id, campaign_id, content_hash),
  UNIQUE (user_id, idempotency_key, content_hash)
);

CREATE TABLE IF NOT EXISTS nblog_media_assets (
  user_id                TEXT NOT NULL,
  campaign_id            TEXT NOT NULL,
  media_id               TEXT NOT NULL,
  type                   TEXT NOT NULL CHECK (type IN ('image', 'video')),
  original_name          TEXT NOT NULL,
  object_key             TEXT,
  local_relative_path    TEXT,
  content_type           TEXT,
  size                   INTEGER NOT NULL DEFAULT 0,
  checksum               TEXT NOT NULL,
  captured_at            TEXT,
  width                  INTEGER,
  height                 INTEGER,
  duration               REAL,
  sort_order             INTEGER NOT NULL,
  included               INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0, 1)),
  is_cover               INTEGER NOT NULL DEFAULT 0 CHECK (is_cover IN (0, 1)),
  analysis_version       TEXT,
  analysis_summary       TEXT,
  warnings_json          TEXT NOT NULL DEFAULT '[]',
  status                 TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'uploading', 'ready', 'failed', 'excluded')),
  updated_at             TEXT NOT NULL,
  PRIMARY KEY (user_id, campaign_id, media_id)
);

CREATE INDEX IF NOT EXISTS idx_nblog_media_order
  ON nblog_media_assets (user_id, campaign_id, sort_order);

CREATE TABLE IF NOT EXISTS nblog_upload_sessions (
  upload_id       TEXT PRIMARY KEY,
  token_hash      TEXT NOT NULL UNIQUE,
  user_id         TEXT NOT NULL,
  campaign_id     TEXT NOT NULL,
  media_id        TEXT NOT NULL,
  object_key      TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  expected_size   INTEGER NOT NULL,
  checksum        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'initialized'
                       CHECK (status IN ('initialized', 'uploading', 'uploaded', 'completed', 'failed', 'expired')),
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nblog_upload_sessions_campaign
  ON nblog_upload_sessions (user_id, campaign_id, status, expires_at);

CREATE TABLE IF NOT EXISTS nblog_prompt_profiles (
  user_id            TEXT NOT NULL,
  prompt_profile_id  TEXT NOT NULL,
  name               TEXT NOT NULL,
  current_version    INTEGER NOT NULL,
  scope              TEXT NOT NULL DEFAULT 'account' CHECK (scope IN ('account', 'campaign')),
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (user_id, prompt_profile_id)
);

CREATE TABLE IF NOT EXISTS nblog_prompt_profile_versions (
  user_id               TEXT NOT NULL,
  prompt_profile_id     TEXT NOT NULL,
  version               INTEGER NOT NULL,
  template              TEXT NOT NULL,
  allowed_placeholders  TEXT NOT NULL,
  change_reason         TEXT NOT NULL,
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  PRIMARY KEY (user_id, prompt_profile_id, version)
);

CREATE TABLE IF NOT EXISTS nblog_handoff_checkpoints (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  campaign_id           TEXT NOT NULL,
  resume_stage          TEXT NOT NULL,
  resume_point          TEXT NOT NULL,
  completed_steps_json  TEXT NOT NULL DEFAULT '[]',
  remaining_steps_json  TEXT NOT NULL DEFAULT '[]',
  artifact_version      INTEGER NOT NULL,
  note                  TEXT,
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nblog_handoff_campaign
  ON nblog_handoff_checkpoints (user_id, campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nblog_publication_history (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  campaign_id          TEXT NOT NULL,
  published_url        TEXT NOT NULL,
  published_at         TEXT NOT NULL,
  confirmed_by         TEXT NOT NULL,
  requirement_version  TEXT,
  draft_version        TEXT,
  validation_version   TEXT,
  profile_version      TEXT,
  reason               TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  UNIQUE (user_id, published_url)
);

CREATE TABLE IF NOT EXISTS nblog_audit_logs (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  campaign_id          TEXT NOT NULL,
  action               TEXT NOT NULL,
  result               TEXT NOT NULL CHECK (result IN ('success', 'failed', 'waiting')),
  from_status          TEXT,
  to_status            TEXT,
  actor                TEXT NOT NULL,
  reason               TEXT,
  requirement_version  TEXT,
  draft_version        TEXT,
  validation_version   TEXT,
  profile_version      TEXT,
  metadata_json        TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nblog_audit_campaign
  ON nblog_audit_logs (user_id, campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nblog_sync_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_nblog_sync_tokens_user
  ON nblog_sync_tokens (user_id, created_at DESC);
