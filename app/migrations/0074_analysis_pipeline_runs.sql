-- 멀티스테이지 분석 실행 상태를 SSE 재접속/폴링 폴백에서 복원한다.

CREATE TABLE IF NOT EXISTS analysis_pipeline_runs (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL,
  user_id               TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  current_stage         TEXT,
  completed_stages_json TEXT NOT NULL DEFAULT '[]',
  error_code            TEXT,
  error_message         TEXT,
  started_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  completed_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_analysis_pipeline_runs_session
  ON analysis_pipeline_runs (session_id, user_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_pipeline_runs_active
  ON analysis_pipeline_runs (session_id, user_id)
  WHERE status = 'running';
