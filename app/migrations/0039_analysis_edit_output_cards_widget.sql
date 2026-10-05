-- Split the /analysis-edit2 edit output-card shell into an SDUI widget.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.outputCards', 'WIDGET', '{"domId":"editOutputCardsSdui","widget":"edit_output_cards"}', 'analysisEdit.root', NULL, 11, NULL, 'edit_output_cards', 'logged_in');
