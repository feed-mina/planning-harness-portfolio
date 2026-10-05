ALTER TABLE usage_limits ADD COLUMN alert_email_enabled INTEGER NOT NULL DEFAULT 1;

ALTER TABLE usage_alerts ADD COLUMN channel TEXT NOT NULL DEFAULT 'in_app';
ALTER TABLE usage_alerts ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'recorded';
ALTER TABLE usage_alerts ADD COLUMN delivered_at TEXT;
ALTER TABLE usage_alerts ADD COLUMN error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_usage_events_day
  ON usage_events (day);

CREATE INDEX IF NOT EXISTS idx_usage_alerts_delivery
  ON usage_alerts (delivery_status, created_at);
