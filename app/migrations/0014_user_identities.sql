CREATE TABLE IF NOT EXISTS user_identities (
  provider         TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  email            TEXT,
  display_name     TEXT,
  avatar_url       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user
  ON user_identities (user_id);
