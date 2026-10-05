-- User-owned meeting action item kanban boards.

CREATE TABLE IF NOT EXISTS kanban_boards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'meeting',
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_kanban_boards_user_updated
  ON kanban_boards (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS kanban_cards (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assignee TEXT,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',
  source_kind TEXT NOT NULL DEFAULT 'meeting_action_item',
  source_id TEXT,
  source_raw TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (board_id) REFERENCES kanban_boards(id),
  UNIQUE(user_id, board_id, source_raw)
);

CREATE INDEX IF NOT EXISTS idx_kanban_cards_user_status
  ON kanban_cards (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_kanban_cards_board_position
  ON kanban_cards (board_id, status, position, created_at);
