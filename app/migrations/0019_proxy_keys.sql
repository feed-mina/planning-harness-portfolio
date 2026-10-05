CREATE TABLE IF NOT EXISTS proxy_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  org_id       TEXT,
  device_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL UNIQUE,
  key_hash     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT,
  CHECK (status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_proxy_keys_user
  ON proxy_keys (user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_proxy_keys_device
  ON proxy_keys (device_id, status);

CREATE TABLE IF NOT EXISTS device_registration_codes (
  code        TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  org_id      TEXT,
  device_name TEXT,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_registration_codes_user
  ON device_registration_codes (user_id, created_at);
