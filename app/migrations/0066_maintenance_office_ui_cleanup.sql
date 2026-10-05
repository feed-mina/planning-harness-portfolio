-- Capture-driven maintenance for office-friendly schedule and content screens.

-- The target time itself is sufficient; the relative-duration badge duplicated the quick buttons.
DELETE FROM ui_metadata
WHERE page_key='time-settings'
  AND node_id='time.quick.targetMode';

-- Content writing does not invoke AI, so do not display an AI budget badge there.
DELETE FROM ui_metadata
WHERE page_key='content'
  AND node_id='content.lead.usage';
