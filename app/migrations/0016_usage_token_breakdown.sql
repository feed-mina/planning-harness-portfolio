-- 토큰 상세 분석용 cache token 컬럼.

ALTER TABLE usage_events ADD COLUMN cache_tokens INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_usage_user_model_day
  ON usage_events (user_id, provider, model, day);
