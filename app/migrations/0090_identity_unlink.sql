-- 소셜 계정(GitHub/Google/Kakao/Naver) 연결 해제 — 감사 로그 + 외부 토큰 폐기 실패 재시도 큐.
CREATE TABLE IF NOT EXISTS identity_unlink_audit (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL,
  provider               TEXT NOT NULL,
  provider_subject       TEXT NOT NULL,
  occurred_at            TEXT NOT NULL,
  local_delete_ok        INTEGER NOT NULL,
  external_revoke_status TEXT NOT NULL,
  failure_code           TEXT,
  ip                     TEXT,
  session_id_hash        TEXT
);

CREATE INDEX IF NOT EXISTS idx_identity_unlink_audit_user
  ON identity_unlink_audit (user_id, occurred_at);

CREATE TABLE IF NOT EXISTS identity_revoke_pending (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  provider        TEXT NOT NULL,
  token_enc       TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL,
  resolved_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_identity_revoke_pending_open
  ON identity_revoke_pending (resolved_at, attempts);
