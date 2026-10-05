-- Garden is available only to GitHub-authenticated accounts with repository access.
DELETE FROM ui_metadata
WHERE page_key = 'garden'
  AND node_id IN (
    'garden.guest',
    'garden.guest.row',
    'garden.guest.copy',
    'garden.guest.login'
  );

UPDATE ui_metadata
SET allowed_roles = 'provider:github',
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'garden';
