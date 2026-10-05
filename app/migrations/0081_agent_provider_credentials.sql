-- Issue #160 (REQ-207): user-registered provider credentials for server-side pull adapters.
-- PAT은 원문 저장 금지 — AES-GCM(iv||ct, base64) 암호문만 저장한다 (키: JWT_SECRET 파생).
-- 등록은 사용자의 명시 행위로만 이루어지며, 브라우저 세션·쿠키 수집과 무관하다.

CREATE TABLE IF NOT EXISTS agent_provider_credentials (
  id                        TEXT PRIMARY KEY,
  user_id                   TEXT NOT NULL,
  provider                  TEXT NOT NULL CHECK (provider IN ('copilot')),
  credential_enc            TEXT NOT NULL,
  account_login             TEXT NOT NULL,
  monthly_included_requests REAL CHECK (monthly_included_requests IS NULL OR monthly_included_requests >= 0),
  last_sync_at              TEXT,
  last_sync_status          TEXT NOT NULL DEFAULT 'never'
                            CHECK (last_sync_status IN ('never', 'ok', 'error')),
  last_sync_message         TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  UNIQUE (user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_provider_credentials_sync
  ON agent_provider_credentials (provider, last_sync_at);
