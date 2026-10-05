-- 회의록/분석 히스토리는 원본과 산출물을 즉시 파기하지 않고 휴지통 처리한다.
-- history_marks는 사용자별 표시 메타이므로 기존 history/time-block 계약을 변경하지 않는다.

ALTER TABLE history_marks ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_history_marks_user_deleted
  ON history_marks (user_id, deleted_at, updated_at);
