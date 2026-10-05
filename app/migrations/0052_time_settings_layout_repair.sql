-- Repair the time-settings SDUI layout after the clock quick-mode rollout.

DELETE FROM ui_metadata
WHERE page_key='time-settings'
  AND node_id='time.integration.guidance';

UPDATE ui_metadata
SET props_json='{"domId":"timeQuickLayout","className":"time-quick-layout time-quick-layout-simple"}',
    group_direction='COLUMN'
WHERE page_key='time-settings'
  AND node_id='time.quick.layout';

UPDATE ui_metadata
SET props_json='{"className":"time-quick-left time-quick-primary"}',
    group_direction='ROW'
WHERE page_key='time-settings'
  AND node_id='time.quick.left';

UPDATE ui_metadata
SET props_json='{"className":"time-quick-right time-quick-secondary"}',
    group_direction='ROW'
WHERE page_key='time-settings'
  AND node_id='time.quick.right';

UPDATE ui_metadata
SET props_json='{"as":"section","className":"save-options-panel compact-save-options"}',
    order_index=1
WHERE page_key='time-settings'
  AND node_id='time.integration.panel';

UPDATE ui_metadata
SET props_json='{"as":"div","className":"field-label","text":"캘린더/알림"}'
WHERE page_key='time-settings'
  AND node_id='time.integration.title';

UPDATE ui_metadata
SET props_json='{"className":"save-option-actions compact-save-actions"}'
WHERE page_key='time-settings'
  AND node_id='time.integration.actions';

UPDATE ui_metadata
SET order_index=0
WHERE page_key='time-settings'
  AND node_id='time.quick.meta';

UPDATE ui_metadata
SET props_json='{"as":"section","className":"panel time-list-panel"}'
WHERE page_key='time-settings'
  AND node_id='time.list.panel';
