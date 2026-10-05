-- Predicted Pages hostnames are previews, not verified deployment URLs.
UPDATE gardens
SET site_url = NULL, updated_at = CURRENT_TIMESTAMP
WHERE status IN ('draft', 'queued', 'running', 'failed');

UPDATE garden_builds
SET site_url = NULL
WHERE status IN ('queued', 'running', 'failed');
