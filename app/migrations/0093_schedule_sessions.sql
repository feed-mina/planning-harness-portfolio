-- 마이페이지 일정 세션, GitHub repo/Project 연결, 보고서와 입장 근거.
-- 적용: wrangler d1 migrations apply harness-meeting-db [--local|--remote]
--
-- schedule_feedback_entries/assets 는 기존 카드 단위 피드백 계약을 유지한다.
-- 세션 피드백 요구가 생기기 전까지 session_id 를 추가하지 않는다.

CREATE TABLE IF NOT EXISTS github_schedule_sources (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  repo          TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  project_title TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (user_id, repo, project_id)
);

CREATE INDEX IF NOT EXISTS idx_github_schedule_sources_user_position
  ON github_schedule_sources (user_id, enabled, position, updated_at);
CREATE INDEX IF NOT EXISTS idx_github_schedule_sources_project
  ON github_schedule_sources (user_id, project_id, repo);

CREATE TABLE IF NOT EXISTS schedule_sessions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  source_id        TEXT,
  title            TEXT NOT NULL,
  starts_at        TEXT NOT NULL,
  ends_at          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled', 'done', 'canceled')),
  host_name        TEXT,
  host_handle      TEXT,
  host_role        TEXT,
  repo             TEXT,
  project_id       TEXT,
  project_title    TEXT,
  room_key         TEXT,
  meeting_url      TEXT,
  meeting_added_by TEXT,
  canceled_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  CHECK (ends_at > starts_at),
  CHECK (meeting_url IS NULL OR meeting_url LIKE 'https://%')
);

CREATE INDEX IF NOT EXISTS idx_schedule_sessions_user_starts
  ON schedule_sessions (user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_schedule_sessions_user_status
  ON schedule_sessions (user_id, status, starts_at);
CREATE INDEX IF NOT EXISTS idx_schedule_sessions_source
  ON schedule_sessions (user_id, source_id, starts_at);

CREATE TABLE IF NOT EXISTS schedule_session_links (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('issue', 'pr')),
  repo          TEXT NOT NULL,
  project_id    TEXT,
  project_title TEXT,
  number        INTEGER NOT NULL CHECK (number > 0),
  title         TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('open', 'draft', 'merged', 'closed')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (session_id, repo, number)
);

CREATE INDEX IF NOT EXISTS idx_schedule_session_links_session
  ON schedule_session_links (session_id);
CREATE INDEX IF NOT EXISTS idx_schedule_session_links_repo_number
  ON schedule_session_links (repo, number);
CREATE INDEX IF NOT EXISTS idx_schedule_session_links_project
  ON schedule_session_links (project_id, repo, state);

CREATE TABLE IF NOT EXISTS schedule_session_reports (
  session_id        TEXT PRIMARY KEY,
  summary           TEXT NOT NULL,
  next_actions_json TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_session_reports_updated
  ON schedule_session_reports (updated_at);

-- 이 테이블은 자체 세션 룸 입장만 기록한다.
-- 외부 meeting_url 로 직접 참여한 경우에는 입장 근거가 생성되지 않는다.
CREATE TABLE IF NOT EXISTS schedule_session_entries (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  entered_at TEXT NOT NULL,
  left_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_session_entries_session
  ON schedule_session_entries (session_id, entered_at);
CREATE INDEX IF NOT EXISTS idx_schedule_session_entries_user
  ON schedule_session_entries (user_id, entered_at);
