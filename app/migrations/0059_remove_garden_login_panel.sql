-- Garden pages are protected by the Worker, so an in-page login panel is redundant.
DELETE FROM ui_metadata
WHERE page_key = 'garden'
  AND node_id IN (
    'garden.guest.login',
    'garden.guest.copy',
    'garden.guest.row',
    'garden.guest'
  );
