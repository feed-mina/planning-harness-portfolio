-- Issue #151: authenticated, user-scoped agent subscription observations.
-- This is deliberately separate from usage_events: subscription allowances are
-- provider-native observations, not Harness API token/cost estimates.

CREATE TABLE IF NOT EXISTS agent_subscriptions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  provider          TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'copilot')),
  plan_label        TEXT NOT NULL DEFAULT '',
  billing_interval  TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (billing_interval IN ('unknown', 'monthly', 'yearly')),
  next_renewal_on   TEXT,
  timezone          TEXT NOT NULL,
  renewal_source    TEXT NOT NULL
                    CHECK (renewal_source IN ('manual', 'provider_api', 'local_bridge')),
  verified_at       TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_subscriptions_user
  ON agent_subscriptions (user_id, provider);

CREATE TABLE IF NOT EXISTS agent_usage_windows (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  provider          TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'copilot')),
  window_kind       TEXT NOT NULL
                    CHECK (window_kind IN ('rolling_5h', 'daily', 'weekly', 'monthly')),
  remaining_value   REAL CHECK (remaining_value IS NULL OR remaining_value >= 0),
  limit_value       REAL CHECK (limit_value IS NULL OR limit_value >= 0),
  unit              TEXT NOT NULL
                    CHECK (unit IN ('percent', 'requests', 'messages', 'credits', 'tokens', 'unknown')),
  resets_at         TEXT,
  source            TEXT NOT NULL
                    CHECK (source IN ('manual', 'provider_api', 'local_bridge')),
  status            TEXT NOT NULL
                    CHECK (status IN ('fresh', 'stale', 'unsupported', 'unconfigured', 'error')),
  observed_at       TEXT NOT NULL,
  message           TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (user_id, provider, window_kind),
  FOREIGN KEY (user_id, provider) REFERENCES agent_subscriptions(user_id, provider)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (
    (provider IN ('claude', 'codex') AND window_kind IN ('rolling_5h', 'weekly'))
    OR (provider = 'copilot' AND window_kind = 'monthly')
  ),
  CHECK (
    (status = 'fresh' AND remaining_value IS NOT NULL AND resets_at IS NOT NULL)
    OR (status <> 'fresh' AND remaining_value IS NULL)
  ),
  CHECK (limit_value IS NULL OR remaining_value IS NULL OR remaining_value <= limit_value)
);

CREATE INDEX IF NOT EXISTS idx_agent_usage_windows_user
  ON agent_usage_windows (user_id, provider, window_kind);
