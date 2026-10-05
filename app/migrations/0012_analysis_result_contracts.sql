-- 분석설계 result_contract 전용 테이블
-- 적용: wrangler d1 migrations apply harness-meeting-db [--local|--remote]

CREATE TABLE IF NOT EXISTS analysis_result_contracts (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL,
  user_id             TEXT NOT NULL,
  plan_id             TEXT NOT NULL,
  title               TEXT NOT NULL,
  kind                TEXT NOT NULL,
  status              TEXT NOT NULL,
  answer              TEXT NOT NULL,
  result_value        TEXT,
  result_number       REAL,
  result_unit         TEXT,
  formula_expression  TEXT,
  evidence_count      INTEGER NOT NULL DEFAULT 0,
  missing_input_count INTEGER NOT NULL DEFAULT 0,
  source_note         TEXT,
  contract_json       TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_result_contracts_plan
  ON analysis_result_contracts (session_id, user_id, plan_id);

CREATE INDEX IF NOT EXISTS idx_analysis_result_contracts_session
  ON analysis_result_contracts (session_id, user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_analysis_result_contracts_kind
  ON analysis_result_contracts (user_id, kind, status, updated_at);
