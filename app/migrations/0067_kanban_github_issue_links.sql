-- Optional GitHub issue linkage for automatic close/reopen on kanban status changes.
ALTER TABLE kanban_cards ADD COLUMN github_repo TEXT;
ALTER TABLE kanban_cards ADD COLUMN github_issue_number INTEGER;
ALTER TABLE kanban_cards ADD COLUMN github_issue_url TEXT;

CREATE INDEX IF NOT EXISTS idx_kanban_cards_github_issue
  ON kanban_cards (user_id, github_repo, github_issue_number);
