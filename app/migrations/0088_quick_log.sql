-- Quick Log (time quick log) tables for buttons, button items, and logs.
CREATE TABLE IF NOT EXISTS user_quick_buttons (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  emoji TEXT,
  color TEXT,
  input_mode TEXT NOT NULL CHECK (input_mode IN ('one_tap', 'pick_item', 'free_text')),
  category TEXT,
  goal_count INTEGER,
  reminder_time TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_quick_button_items (
  id TEXT PRIMARY KEY,
  button_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_quick_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  button_id TEXT,
  button_label TEXT NOT NULL,
  item_label TEXT,
  note TEXT,
  location TEXT,
  photo_key TEXT,
  logged_at TEXT NOT NULL,
  logged_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (button_id) REFERENCES user_quick_buttons (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quick_logs_user_date
  ON user_quick_logs (user_id, logged_date);

CREATE INDEX IF NOT EXISTS idx_quick_logs_user_button_date
  ON user_quick_logs (user_id, button_id, logged_date);

CREATE INDEX IF NOT EXISTS idx_quick_button_items_button_order
  ON user_quick_button_items (button_id, order_index);

CREATE INDEX IF NOT EXISTS idx_quick_buttons_user_order
  ON user_quick_buttons (user_id, deleted_at, order_index, created_at);
