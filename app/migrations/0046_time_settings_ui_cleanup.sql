-- Refresh the SDUI time-settings layout per the simplified time-block flow.

DELETE FROM ui_metadata
WHERE page_key='time-settings'
  AND node_id IN (
    'time.guest.copy',
    'time.settings.panel',
    'time.settings.label',
    'time.settings.meta',
    'time.settings.tzLabel',
    'time.settings.tzText',
    'time.settings.tzInput',
    'time.settings.startLabel',
    'time.settings.startText',
    'time.settings.startInput',
    'time.settings.endLabel',
    'time.settings.endText',
    'time.settings.endInput',
    'time.weekdays.label',
    'time.weekdays.row',
    'time.weekday.mon',
    'time.weekday.tue',
    'time.weekday.wed',
    'time.weekday.thu',
    'time.weekday.fri',
    'time.weekday.sat',
    'time.weekday.sun',
    'time.settings.actions',
    'time.settings.save',
    'time.settings.status',
    'time.block.hint',
    'time.block.kindLabel',
    'time.block.kindText',
    'time.block.kindInput',
    'time.head.kind'
  );

UPDATE ui_metadata
SET props_json='{"className":"time-settings-main"}',
    group_direction='COLUMN'
WHERE page_key='time-settings'
  AND node_id='time.grid';

UPDATE ui_metadata
SET props_json='{"as":"section","className":"panel time-block-panel"}'
WHERE page_key='time-settings'
  AND node_id='time.block.panel';

UPDATE ui_metadata
SET props_json='{"className":"time-block-form-grid"}'
WHERE page_key='time-settings'
  AND node_id='time.block.meta';

UPDATE ui_metadata
SET order_index=1
WHERE page_key='time-settings'
  AND node_id='time.block.startLabel';

UPDATE ui_metadata
SET order_index=2
WHERE page_key='time-settings'
  AND node_id='time.block.endLabel';

UPDATE ui_metadata
SET order_index=3
WHERE page_key='time-settings'
  AND node_id='time.block.noteLabel';

UPDATE ui_metadata
SET order_index=1
WHERE page_key='time-settings'
  AND node_id='time.head.note';

UPDATE ui_metadata
SET order_index=2
WHERE page_key='time-settings'
  AND node_id='time.head.manage';

UPDATE ui_metadata
SET parent_node_id='time.integration.panel',
    order_index=0
WHERE page_key='time-settings'
  AND node_id='time.integration.title';

UPDATE ui_metadata
SET parent_node_id='time.integration.panel',
    order_index=1
WHERE page_key='time-settings'
  AND node_id='time.integration.actions';

UPDATE ui_metadata
SET parent_node_id='time.integration.panel',
    order_index=2
WHERE page_key='time-settings'
  AND node_id='time.integration.status';

UPDATE ui_metadata
SET order_index=4
WHERE page_key='time-settings'
  AND node_id='time.repeat.panel';

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('time-settings', 'time.block.tzLabel', 'GROUP', '{"as":"label","className":"timezone-field"}', 'time.block.meta', 'COLUMN', 0, NULL, NULL, NULL),
  ('time-settings', 'time.block.tzText', 'TEXT', '{"as":"span","text":"타임존"}', 'time.block.tzLabel', NULL, 0, NULL, NULL, NULL),
  ('time-settings', 'time.block.tzInput', 'SELECT', '{"domId":"timezone","value":"Asia/Seoul","options":[{"value":"Asia/Seoul","label":"서울"},{"value":"Asia/Tokyo","label":"도쿄"},{"value":"Europe/London","label":"런던"},{"value":"America/New_York","label":"뉴욕"},{"value":"America/Los_Angeles","label":"로스앤젤레스"}]}', 'time.block.tzLabel', NULL, 1, NULL, NULL, NULL),
  ('time-settings', 'time.integration.panel', 'GROUP', '{"as":"section","className":"integration-panel"}', 'time.block.panel', 'COLUMN', 3, NULL, NULL, NULL);
