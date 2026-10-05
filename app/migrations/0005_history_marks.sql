-- 마이페이지 통합 히스토리: 사용자 태그와 즐겨찾기 메타
-- 적용: wrangler d1 migrations apply harness-meeting-db [--local|--remote]

CREATE TABLE IF NOT EXISTS history_marks (
  user_id    TEXT NOT NULL,
  item_type  TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  tags       TEXT,
  favorite   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_type, item_id)
);
CREATE INDEX IF NOT EXISTS idx_history_marks_user ON history_marks (user_id, updated_at);
