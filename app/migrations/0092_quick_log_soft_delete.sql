-- 퀵 기록 soft delete (#252)
-- 삭제를 물리 삭제에서 마킹으로 바꿔, 실행 취소 시 logged_at 을 원래 값 그대로 되살린다.
-- 기존 행은 deleted_at 이 NULL 이므로 활성 상태로 유지된다.
ALTER TABLE user_quick_logs ADD COLUMN deleted_at TEXT;

-- 활성 기록 조회(overview/history/집계)가 전부 user_id + deleted_at + logged_date 조건을 쓴다.
CREATE INDEX IF NOT EXISTS idx_user_quick_logs_active
  ON user_quick_logs (user_id, deleted_at, logged_date);
