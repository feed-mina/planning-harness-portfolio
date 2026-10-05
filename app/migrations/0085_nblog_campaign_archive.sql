-- 캠페인 보관(soft delete): status/operation_status 의 CHECK 제약을 건드리지 않도록
-- 별도 타임스탬프 컬럼으로 보관 여부를 표시한다. NULL = 활성, 값 있음 = 보관됨.

ALTER TABLE nblog_campaigns
  ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_nblog_campaigns_archived
  ON nblog_campaigns (user_id, archived_at, updated_at DESC);
