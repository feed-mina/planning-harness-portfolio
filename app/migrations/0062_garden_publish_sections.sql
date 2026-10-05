-- Issue #93 Phase 2: choose analysis output kinds exposed by a Garden.
INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('garden', 'garden.form.publishSections', 'WIDGET', '{"domId":"gardenPublishSections","className":"garden-publish-sections"}', 'garden.form.panel', NULL, 4, NULL, 'garden_publish_sections', NULL);

UPDATE ui_metadata SET order_index=5 WHERE page_key='garden' AND node_id='garden.taxonomy';
UPDATE ui_metadata SET order_index=6 WHERE page_key='garden' AND node_id='garden.form.actions';
