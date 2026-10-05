-- Quick Log reminder settings (#213 1차 MVP) — 사용자 단위 알림 시간, Quick Log 버튼과 독립적으로 설계.
CREATE TABLE IF NOT EXISTS quick_log_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
  last_sent_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quick_log_reminders_enabled_time
  ON quick_log_reminders (enabled, time);
