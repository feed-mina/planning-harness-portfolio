CREATE TABLE IF NOT EXISTS email_credentials (
  email         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  display_name  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_devices (
  device_id     TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  linked_at     TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user
  ON user_devices (user_id, last_seen_at);
