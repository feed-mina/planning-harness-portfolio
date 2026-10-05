CREATE TABLE IF NOT EXISTS user_time_settings (
  user_id        TEXT PRIMARY KEY,
  timezone       TEXT NOT NULL DEFAULT 'Asia/Seoul',
  workday_start  TEXT NOT NULL DEFAULT '09:00',
  workday_end    TEXT NOT NULL DEFAULT '18:00',
  weekdays_json  TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_time_blocks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  date        TEXT NOT NULL,
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'available'
                CHECK (kind IN ('available', 'busy', 'focus', 'meeting')),
  note        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_time_blocks_user_date
  ON user_time_blocks (user_id, date, start_time);

CREATE TABLE IF NOT EXISTS content_posts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  visibility   TEXT NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private', 'team', 'public')),
  tags_json    TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_posts_user
  ON content_posts (user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_content_posts_visibility
  ON content_posts (visibility, updated_at);

CREATE TABLE IF NOT EXISTS content_assets (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT,
  size        INTEGER NOT NULL DEFAULT 0,
  r2_key      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_assets_post
  ON content_assets (post_id, created_at);
