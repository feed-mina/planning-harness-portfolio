-- 분석 파일 인덱싱을 Cloudflare Queues 기반 비동기 작업으로 추적한다.

ALTER TABLE analysis_files ADD COLUMN index_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE analysis_files ADD COLUMN index_error TEXT;
ALTER TABLE analysis_files ADD COLUMN index_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_files ADD COLUMN index_run_id TEXT;
ALTER TABLE analysis_files ADD COLUMN index_updated_at TEXT;
ALTER TABLE analysis_files ADD COLUMN indexed_at TEXT;

UPDATE analysis_files
SET index_status = CASE
      WHEN text_excerpt IS NULL OR trim(text_excerpt) = '' THEN 'done'
      WHEN EXISTS (
        SELECT 1 FROM analysis_chunks c
        WHERE c.session_id = analysis_files.session_id
          AND c.user_id = analysis_files.user_id
          AND c.file_id = analysis_files.id
      ) THEN 'done'
      ELSE 'pending'
    END,
    index_updated_at = created_at,
    indexed_at = CASE
      WHEN text_excerpt IS NULL OR trim(text_excerpt) = '' THEN created_at
      WHEN EXISTS (
        SELECT 1 FROM analysis_chunks c
        WHERE c.session_id = analysis_files.session_id
          AND c.user_id = analysis_files.user_id
          AND c.file_id = analysis_files.id
      ) THEN created_at
      ELSE NULL
    END;

CREATE INDEX IF NOT EXISTS idx_analysis_files_index_status
  ON analysis_files (index_status, index_updated_at);
