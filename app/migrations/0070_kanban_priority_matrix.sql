-- Persist the two axes used by the interactive priority matrix.
ALTER TABLE kanban_cards ADD COLUMN importance TEXT NOT NULL DEFAULT 'low';
ALTER TABLE kanban_cards ADD COLUMN urgency TEXT NOT NULL DEFAULT 'low';

CREATE INDEX IF NOT EXISTS idx_kanban_cards_priority_matrix
  ON kanban_cards (user_id, importance, urgency, status);
