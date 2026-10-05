-- 음성메모를 생성 근거로 쓴다 (#186).
--
-- nblog_media_assets 에 합치지 않는 이유:
--   1. type CHECK 제약(image|video)을 SQLite 에서 바꾸려면 테이블을 다시 만들어야 한다
--   2. 음성은 본문에 배치할 대상이 아니라 근거다. 미디어 그리드의 순서 조정(↑↓)이나
--      [IMAGE:001] 표시 대상이 아니므로 같은 테이블에 두면 의미가 흐려진다
CREATE TABLE IF NOT EXISTS nblog_voice_notes (
  user_id            TEXT NOT NULL,
  campaign_id        TEXT NOT NULL,
  note_id            TEXT NOT NULL,
  object_key         TEXT NOT NULL,
  original_name      TEXT NOT NULL,
  content_type       TEXT,
  size               INTEGER NOT NULL DEFAULT 0,
  checksum           TEXT NOT NULL,
  -- 전사 결과. 사용자가 고칠 수 있고, 고치면 edited=1 이 되어 재전사 대상에서 빠진다.
  transcript         TEXT NOT NULL DEFAULT '',
  transcript_status  TEXT NOT NULL DEFAULT 'pending'
                       CHECK (transcript_status IN ('pending', 'ready', 'failed')),
  transcript_error   TEXT,
  edited             INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (user_id, campaign_id, note_id)
);

CREATE INDEX IF NOT EXISTS idx_nblog_voice_notes_campaign
  ON nblog_voice_notes (user_id, campaign_id, created_at);
