-- Issue #94 Phase 2: durable build deduplication and successful deployment reuse.
ALTER TABLE garden_builds ADD COLUMN build_fingerprint TEXT;
ALTER TABLE garden_builds ADD COLUMN builder_version TEXT;

CREATE INDEX IF NOT EXISTS idx_garden_builds_fingerprint
  ON garden_builds (garden_id, build_fingerprint, status);
