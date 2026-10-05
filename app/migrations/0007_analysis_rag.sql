-- 분석설계 RAG Phase 1: 분석파일 청킹/벡터 메타
-- 적용: wrangler d1 migrations apply harness-meeting-db [--local|--remote]

CREATE TABLE IF NOT EXISTS analysis_chunks (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  file_id            TEXT NOT NULL,
  chunk_index        INTEGER NOT NULL,
  text               TEXT NOT NULL,
  embedding_provider TEXT,
  embedding_model    TEXT,
  vector_id          TEXT,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_chunks_session ON analysis_chunks (session_id, user_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_analysis_chunks_file ON analysis_chunks (file_id, user_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_analysis_chunks_vector ON analysis_chunks (vector_id);
