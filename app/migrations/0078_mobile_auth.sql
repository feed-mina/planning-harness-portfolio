-- Mobile OAuth handoff and opaque bearer sessions.
-- Raw authorization codes and tokens are returned once to the client and are
-- never persisted. All *_hash values are canonical lowercase SHA-256 hex.

CREATE TABLE mobile_auth_codes (
  id                  TEXT PRIMARY KEY,
  code_hash           TEXT NOT NULL UNIQUE
                        CHECK (length(code_hash) = 64
                          AND code_hash = lower(code_hash)
                          AND code_hash NOT GLOB '*[^0-9a-f]*'),
  user_id             TEXT NOT NULL,
  code_challenge      TEXT NOT NULL
                        CHECK (length(code_challenge) = 43
                          AND code_challenge NOT GLOB '*[^A-Za-z0-9_-]*'),
  code_challenge_method TEXT NOT NULL DEFAULT 'S256'
                        CHECK (code_challenge_method = 'S256'),
  redirect_uri        TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL CHECK (expires_at > created_at),
  consumed_at         INTEGER,
  cancelled_at        INTEGER,
  consume_nonce       TEXT UNIQUE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (NOT (consumed_at IS NOT NULL AND cancelled_at IS NOT NULL))
);

CREATE INDEX idx_mobile_auth_codes_active
  ON mobile_auth_codes (code_hash, expires_at)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE mobile_sessions (
  id                  TEXT PRIMARY KEY,
  family_id           TEXT NOT NULL,
  parent_session_id   TEXT,
  user_id             TEXT NOT NULL,
  access_token_hash   TEXT NOT NULL UNIQUE
                        CHECK (length(access_token_hash) = 64
                          AND access_token_hash = lower(access_token_hash)
                          AND access_token_hash NOT GLOB '*[^0-9a-f]*'),
  refresh_token_hash  TEXT NOT NULL UNIQUE
                        CHECK (length(refresh_token_hash) = 64
                          AND refresh_token_hash = lower(refresh_token_hash)
                          AND refresh_token_hash NOT GLOB '*[^0-9a-f]*'),
  access_expires_at   INTEGER NOT NULL,
  refresh_expires_at  INTEGER NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  last_used_at        INTEGER,
  revoked_at          INTEGER,
  revoke_reason       TEXT,
  rotated_to_session_id TEXT,
  rotation_nonce      TEXT UNIQUE,
  reuse_detected_at   INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (parent_session_id) REFERENCES mobile_sessions(id) ON DELETE SET NULL,
  CHECK (access_expires_at > created_at),
  CHECK (refresh_expires_at > created_at),
  CHECK (access_expires_at <= refresh_expires_at),
  CHECK (revoke_reason IS NULL OR revoke_reason IN ('rotated', 'refresh_reuse', 'revoked', 'expired'))
);

CREATE INDEX idx_mobile_sessions_access_active
  ON mobile_sessions (access_token_hash, access_expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_mobile_sessions_refresh
  ON mobile_sessions (refresh_token_hash, refresh_expires_at);

CREATE INDEX idx_mobile_sessions_family
  ON mobile_sessions (family_id, created_at);

-- Fixed-window limits are keyed by hashes of IP/user/token-family subjects so
-- raw network addresses and identifiers are not persisted in the limiter.
CREATE TABLE mobile_auth_rate_limits (
  scope               TEXT NOT NULL,
  subject_hash        TEXT NOT NULL
                        CHECK (length(subject_hash) = 64
                          AND subject_hash = lower(subject_hash)
                          AND subject_hash NOT GLOB '*[^0-9a-f]*'),
  window_started_at   INTEGER NOT NULL,
  request_count       INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
  expires_at          INTEGER NOT NULL CHECK (expires_at > window_started_at),
  PRIMARY KEY (scope, subject_hash, window_started_at)
);

CREATE INDEX idx_mobile_auth_rate_limits_expiry
  ON mobile_auth_rate_limits (expires_at);
