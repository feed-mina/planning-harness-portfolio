-- User-owned Clova recording imports and transcript cache.

CREATE TABLE IF NOT EXISTS clova_recordings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  external_recording_id TEXT,
  title TEXT NOT NULL,
  recorded_at TEXT,
  duration_sec INTEGER,
  transcript_text TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'needs_transcript',
  source_provider TEXT NOT NULL DEFAULT 'clova',
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, external_recording_id)
);

CREATE INDEX IF NOT EXISTS idx_clova_recordings_user_updated
  ON clova_recordings (user_id, updated_at);

