-- 오늘 AI 사용 기록은 보존하면서 한도 계산 구간만 새로 시작한다.

CREATE TABLE IF NOT EXISTS usage_resets (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                  TEXT NOT NULL,
  day                      TEXT NOT NULL,
  reset_at                 TEXT NOT NULL,
  previous_window_used_krw REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_usage_resets_user_day
  ON usage_resets (user_id, day, reset_at);
