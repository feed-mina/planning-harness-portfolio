-- 일일 예산 경계와 분석 보존기간 정리를 멱등하게 추적한다.

ALTER TABLE usage_resets ADD COLUMN reason TEXT NOT NULL DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_resets_daily_unique
  ON usage_resets (user_id, day)
  WHERE reason = 'daily';

CREATE TABLE IF NOT EXISTS analysis_cleanup_jobs (
  session_id      TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'queueing', 'queued', 'processing', 'retry', 'completed', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_analysis_cleanup_jobs_due
  ON analysis_cleanup_jobs (status, next_attempt_at, updated_at);
