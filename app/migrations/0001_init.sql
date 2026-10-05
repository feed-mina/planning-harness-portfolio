-- 기획 하네스 회의록 앱 — 초기 스키마 (D1 / SQLite)
-- 적용: wrangler d1 migrations apply harness-meeting-db [--local|--remote]

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,        -- 내부 사용자 id (github id 기반)
  github_login TEXT,
  github_id    INTEGER UNIQUE,
  created_at   TEXT NOT NULL
);

-- provider 호출 사용량 (토큰 기반). 비용은 원(KRW) 환산치.
CREATE TABLE IF NOT EXISTS usage_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,          -- 로그인 사용자 id 또는 익명 세션 id
  day           TEXT NOT NULL,          -- YYYY-MM-DD (UTC) — 일 한도 집계 키
  provider      TEXT NOT NULL,          -- claude | openai | gemini
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_krw      REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user_day ON usage_events (user_id, day);

-- 생성된 회의록 메타 (본문/오디오는 R2)
CREATE TABLE IF NOT EXISTS meetings (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT,
  date       TEXT,                      -- 회의 날짜
  r2_key     TEXT,                      -- R2 객체 키 (예: meetings/<user>/<id>.md)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meetings_user ON meetings (user_id, created_at);

-- 사용자별 기본 설정 (git 연동 기본값 등)
CREATE TABLE IF NOT EXISTS settings (
  user_id          TEXT PRIMARY KEY,
  default_repo     TEXT,                -- owner/name
  default_project  INTEGER,
  default_provider TEXT,                -- claude | openai | gemini
  updated_at       TEXT NOT NULL
);
