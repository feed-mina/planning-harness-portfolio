-- AI prompt/model evaluation: cases, runs, and reportable metrics.
-- Apply with: wrangler d1 migrations apply harness-meeting-db [--local|--remote]

CREATE TABLE IF NOT EXISTS ai_eval_cases (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  name           TEXT NOT NULL,
  stage          TEXT NOT NULL,
  input_json     TEXT NOT NULL,
  expected_json  TEXT,
  prompt_version TEXT NOT NULL DEFAULT 'default',
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_eval_cases_user_stage ON ai_eval_cases (user_id, stage, enabled);

CREATE TABLE IF NOT EXISTS ai_eval_runs (
  id                   TEXT PRIMARY KEY,
  case_id              TEXT NOT NULL,
  user_id              TEXT NOT NULL,
  stage                TEXT NOT NULL,
  prompt_version       TEXT NOT NULL DEFAULT 'default',
  provider             TEXT NOT NULL,
  model                TEXT NOT NULL,
  actual_provider      TEXT,
  actual_model         TEXT,
  latency_ms           INTEGER NOT NULL DEFAULT 0,
  input_tokens         INTEGER NOT NULL DEFAULT 0,
  output_tokens        INTEGER NOT NULL DEFAULT 0,
  cost_krw             REAL NOT NULL DEFAULT 0,
  success              INTEGER NOT NULL DEFAULT 0,
  error                TEXT,
  json_parse_ok        INTEGER NOT NULL DEFAULT 0,
  schema_ok            INTEGER NOT NULL DEFAULT 0,
  source_citation_hit  INTEGER NOT NULL DEFAULT 0,
  judge_score          REAL,
  fallback_from        TEXT,
  dagshub_sync_status  TEXT,
  dagshub_run_url      TEXT,
  output_json          TEXT,
  created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_eval_runs_user_created ON ai_eval_runs (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_eval_runs_case ON ai_eval_runs (case_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_eval_runs_group ON ai_eval_runs (user_id, stage, prompt_version, provider, model);
