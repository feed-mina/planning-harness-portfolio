-- Issue #156: authenticated AI -> SDUI validation and approval audit gates.
-- Approval jobs are intentionally write-only for trusted/internal producers.
-- No public route creates or executes these jobs.

CREATE TABLE ai_sdui_approval_jobs (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  operation             TEXT NOT NULL CHECK (operation IN (
                            'MODIFY_CODE',
                            'PUSH_CHANGES',
                            'DEPLOY',
                            'DELETE_RESOURCE'
                          )),
  payload_hash          TEXT NOT NULL CHECK (
                            length(payload_hash) = 64
                            AND payload_hash = lower(payload_hash)
                            AND payload_hash NOT GLOB '*[^0-9a-f]*'
                          ),
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending',
                            'approved',
                            'revoked'
                          )),
  dry_run               INTEGER NOT NULL CHECK (dry_run = 1),
  server_check_required INTEGER NOT NULL CHECK (server_check_required = 1),
  expires_at            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  approved_at           TEXT,
  CHECK (
    (status = 'approved' AND approved_at IS NOT NULL)
    OR (status != 'approved' AND approved_at IS NULL)
  ),
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX idx_ai_sdui_approval_jobs_user_status_expiry
  ON ai_sdui_approval_jobs (user_id, status, expires_at);

CREATE TABLE ai_sdui_validation_events (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  result_id      TEXT,
  schema_id      TEXT,
  accepted       INTEGER NOT NULL CHECK (accepted IN (0, 1)),
  stage          TEXT NOT NULL CHECK (stage IN (
                   'request',
                   'structure',
                   'catalog',
                   'action',
                   'approval',
                   'accepted'
                 )),
  reason_code    TEXT NOT NULL,
  payload_sha256 TEXT CHECK (
                   payload_sha256 IS NULL
                   OR (
                     length(payload_sha256) = 64
                     AND payload_sha256 = lower(payload_sha256)
                     AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
                   )
                 ),
  created_at     TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX idx_ai_sdui_validation_events_user_created
  ON ai_sdui_validation_events (user_id, created_at DESC);
