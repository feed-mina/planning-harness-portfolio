ALTER TABLE usage_events ADD COLUMN org_id TEXT;
ALTER TABLE usage_events ADD COLUMN device_id TEXT;
ALTER TABLE usage_events ADD COLUMN proxy_key_id TEXT;
ALTER TABLE usage_events ADD COLUMN source TEXT NOT NULL DEFAULT 'app';
ALTER TABLE usage_events ADD COLUMN request_id TEXT;
ALTER TABLE usage_events ADD COLUMN latency_ms INTEGER;
ALTER TABLE usage_events ADD COLUMN status_code INTEGER;
ALTER TABLE usage_events ADD COLUMN error_code TEXT;
ALTER TABLE usage_events ADD COLUMN metadata_json TEXT;

CREATE INDEX IF NOT EXISTS idx_usage_org_day
  ON usage_events (org_id, day);

CREATE INDEX IF NOT EXISTS idx_usage_device_day
  ON usage_events (device_id, day);

CREATE INDEX IF NOT EXISTS idx_usage_source_day
  ON usage_events (source, day);

CREATE INDEX IF NOT EXISTS idx_usage_request
  ON usage_events (request_id);
