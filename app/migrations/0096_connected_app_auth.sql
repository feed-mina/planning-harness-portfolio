-- Harness -> connected application authorization handoff.
--
-- Authorization codes and exchange IDs are returned/accepted only at the
-- protocol boundary. D1 stores canonical lowercase SHA-256 hashes so a
-- database read cannot replay either credential.

CREATE TABLE connected_app_authorization_codes (
  id                    TEXT PRIMARY KEY,
  code_hash             TEXT NOT NULL UNIQUE
                          CHECK (length(code_hash) = 64
                            AND code_hash = lower(code_hash)
                            AND code_hash NOT GLOB '*[^0-9a-f]*'),
  user_id               TEXT NOT NULL,
  client_id             TEXT NOT NULL,
  audience              TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  redirect_uri          TEXT NOT NULL,
  issuer                TEXT NOT NULL,
  environment           TEXT NOT NULL,
  code_challenge        TEXT NOT NULL
                          CHECK (length(code_challenge) = 43
                            AND code_challenge NOT GLOB '*[^A-Za-z0-9_-]*'),
  code_challenge_method TEXT NOT NULL DEFAULT 'S256'
                          CHECK (code_challenge_method = 'S256'),
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL
                          CHECK (expires_at > created_at
                            AND expires_at <= created_at + 120),
  consumed_at           INTEGER,
  exchange_id_hash      TEXT UNIQUE
                          CHECK (exchange_id_hash IS NULL
                            OR (length(exchange_id_hash) = 64
                              AND exchange_id_hash = lower(exchange_id_hash)
                              AND exchange_id_hash NOT GLOB '*[^0-9a-f]*')),
  consume_nonce         TEXT UNIQUE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (
    (consumed_at IS NULL AND exchange_id_hash IS NULL AND consume_nonce IS NULL)
    OR
    (consumed_at IS NOT NULL AND exchange_id_hash IS NOT NULL AND consume_nonce IS NOT NULL)
  )
);

CREATE INDEX idx_connected_app_codes_active
  ON connected_app_authorization_codes (code_hash, expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX idx_connected_app_codes_user
  ON connected_app_authorization_codes (user_id, created_at);
