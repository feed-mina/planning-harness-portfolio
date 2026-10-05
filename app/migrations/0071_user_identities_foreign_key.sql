-- Rebuild user_identities so every identity belongs to an existing logical user.
-- Preserve legacy identities by creating their missing logical user row first.
INSERT OR IGNORE INTO users (id, github_login, github_id, created_at)
SELECT user_id, COALESCE(MAX(display_name), user_id), NULL, COALESCE(MIN(created_at), CURRENT_TIMESTAMP)
FROM user_identities
GROUP BY user_id;

CREATE TABLE user_identities_new (
  provider         TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  email            TEXT,
  display_name     TEXT,
  avatar_url       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (provider, provider_subject),
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
);

INSERT INTO user_identities_new
  (provider, provider_subject, user_id, email, display_name, avatar_url, created_at, updated_at)
SELECT provider, provider_subject, user_id, email, display_name, avatar_url, created_at, updated_at
FROM user_identities;

DROP TABLE user_identities;
ALTER TABLE user_identities_new RENAME TO user_identities;

CREATE INDEX idx_user_identities_user ON user_identities (user_id);
