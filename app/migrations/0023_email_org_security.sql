ALTER TABLE email_credentials ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_credentials ADD COLUMN verification_token_hash TEXT;
ALTER TABLE email_credentials ADD COLUMN verification_expires_at TEXT;
ALTER TABLE email_credentials ADD COLUMN verification_sent_at TEXT;
ALTER TABLE email_credentials ADD COLUMN verification_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_credentials ADD COLUMN verification_locked_until TEXT;
ALTER TABLE email_credentials ADD COLUMN reset_token_hash TEXT;
ALTER TABLE email_credentials ADD COLUMN reset_expires_at TEXT;
ALTER TABLE email_credentials ADD COLUMN reset_sent_at TEXT;
ALTER TABLE email_credentials ADD COLUMN reset_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_credentials ADD COLUMN reset_locked_until TEXT;
ALTER TABLE email_credentials ADD COLUMN login_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_credentials ADD COLUMN login_locked_until TEXT;
ALTER TABLE email_credentials ADD COLUMN last_login_at TEXT;

CREATE INDEX IF NOT EXISTS idx_email_credentials_verification_token
  ON email_credentials (verification_token_hash);

CREATE INDEX IF NOT EXISTS idx_email_credentials_reset_token
  ON email_credentials (reset_token_hash);

ALTER TABLE organizations ADD COLUMN reveal_member_identifiers INTEGER NOT NULL DEFAULT 1;
ALTER TABLE organizations ADD COLUMN allow_raw_usage_export INTEGER NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN admin_overage_email_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE organizations ADD COLUMN audit_log_retention_days INTEGER NOT NULL DEFAULT 90;

CREATE TABLE IF NOT EXISTS organization_audit_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         TEXT NOT NULL,
  actor_user_id  TEXT NOT NULL,
  action         TEXT NOT NULL,
  target_user_id TEXT,
  metadata_json  TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_org_audit_logs_org_created
  ON organization_audit_logs (org_id, created_at);
