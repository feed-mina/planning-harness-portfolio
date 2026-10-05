-- 사용자/기기별 AI 비용 한도와 임계치 알림.

CREATE TABLE IF NOT EXISTS usage_limits (
  user_id            TEXT PRIMARY KEY,
  daily_limit_krw    REAL NOT NULL,
  warn_threshold_krw REAL NOT NULL,
  block_on_exceed    INTEGER NOT NULL DEFAULT 1,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  day           TEXT NOT NULL,
  kind          TEXT NOT NULL, -- warning | limit
  threshold_krw REAL NOT NULL,
  used_krw      REAL NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE(user_id, day, kind)
);

CREATE INDEX IF NOT EXISTS idx_usage_alerts_user_day
  ON usage_alerts (user_id, day, created_at);
