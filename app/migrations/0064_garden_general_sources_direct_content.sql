-- General users need to choose their own analysis/meeting sources, and may
-- publish a Garden from directly written content without GitHub.
UPDATE ui_metadata
SET allowed_roles = NULL, updated_at = CURRENT_TIMESTAMP
WHERE page_key='garden' AND node_id='garden.form.sources';

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('garden', 'garden.form.directContent', 'WIDGET', '{"domId":"gardenDirectContentWrap","className":"garden-direct-content"}', 'garden.form.panel', NULL, 4, NULL, 'garden_direct_content', NULL);

UPDATE ui_metadata SET order_index=5 WHERE page_key='garden' AND node_id='garden.form.publishSections';
UPDATE ui_metadata SET order_index=6 WHERE page_key='garden' AND node_id='garden.taxonomy';
UPDATE ui_metadata SET order_index=7 WHERE page_key='garden' AND node_id='garden.form.actions';
