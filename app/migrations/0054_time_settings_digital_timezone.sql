-- Replace the analog clock with a timezone-aware digital display.
DELETE FROM ui_metadata
WHERE page_key = 'time-settings'
  AND node_id = 'time.quick.clockFace';

UPDATE ui_metadata
SET props_json = '{"className":"time-clock-body time-digital-body"}',
    group_direction = 'COLUMN',
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'time-settings'
  AND node_id = 'time.quick.clockBody';

UPDATE ui_metadata
SET props_json = '{"className":"time-clock-copy time-digital-clock"}',
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'time-settings'
  AND node_id = 'time.quick.clockCopy';

UPDATE ui_metadata
SET props_json = '{"as":"div","domId":"currentTimeText","className":"time-current-text","text":"15:40:00"}',
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'time-settings'
  AND node_id = 'time.quick.currentText';

UPDATE ui_metadata
SET order_index = 2,
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'time-settings'
  AND node_id = 'time.quick.currentHint';

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('time-settings', 'time.quick.currentZone', 'TEXT', '{"as":"span","domId":"currentTimezoneText","className":"time-digital-zone","text":"서울 · UTC+09:00"}', 'time.quick.clockCopy', NULL, 1, NULL, NULL, NULL);
