-- 마이페이지 일정 카드 피드백/자료 등록
-- 적용: wrangler d1 migrations apply harness-meeting-db [--local|--remote]

CREATE TABLE IF NOT EXISTS schedule_feedback_entries (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  card_id            TEXT NOT NULL,
  repo               TEXT NOT NULL,
  issue_number       INTEGER,
  issue_title        TEXT,
  body               TEXT NOT NULL,
  github_issue_url   TEXT,
  github_comment_url TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_feedback_entries_user_card
  ON schedule_feedback_entries (user_id, card_id, created_at);
CREATE INDEX IF NOT EXISTS idx_schedule_feedback_entries_repo_issue
  ON schedule_feedback_entries (repo, issue_number, created_at);

CREATE TABLE IF NOT EXISTS schedule_feedback_assets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  card_id      TEXT NOT NULL,
  repo         TEXT NOT NULL,
  issue_number INTEGER,
  issue_title  TEXT,
  name         TEXT NOT NULL,
  type         TEXT,
  size         INTEGER NOT NULL,
  r2_key       TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedule_feedback_assets_user_card
  ON schedule_feedback_assets (user_id, card_id, created_at);
CREATE INDEX IF NOT EXISTS idx_schedule_feedback_assets_repo_issue
  ON schedule_feedback_assets (repo, issue_number, created_at);
