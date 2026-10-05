-- 분석설계 Phase 2: 분석 세션, 분석 파일 메타, AI 산출물
-- 적용: wrangler d1 migrations apply harness-meeting-db [--local|--remote]

CREATE TABLE IF NOT EXISTS analysis_sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  title          TEXT,
  date           TEXT,
  subject        TEXT,
  meeting_r2_key TEXT,
  etc_url        TEXT,
  etc_note       TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analysis_sessions_user ON analysis_sessions (user_id, created_at);

CREATE TABLE IF NOT EXISTS analysis_files (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT,
  size         INTEGER NOT NULL,
  r2_key       TEXT NOT NULL,
  text_excerpt TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analysis_files_session ON analysis_files (session_id, created_at);

CREATE TABLE IF NOT EXISTS analysis_outputs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  content_json  TEXT NOT NULL,
  provider      TEXT,
  model         TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analysis_outputs_session_kind ON analysis_outputs (session_id, kind, created_at);
