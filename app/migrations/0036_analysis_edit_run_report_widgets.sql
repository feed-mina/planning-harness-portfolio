-- Split lower-risk /analysis-edit2 controls into SDUI widgets.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.runControls', 'WIDGET', '{"domId":"analysisRunControlsSdui","widget":"analysis_run_controls"}', 'analysisEdit.root', NULL, 7, NULL, 'analysis_run_controls', 'logged_in'),
  ('analysis-edit', 'analysisEdit.reportActions', 'WIDGET', '{"domId":"reportActionsSdui","widget":"report_action_buttons","className":"print-actions result-actions"}', 'analysisEdit.root', NULL, 8, NULL, 'report_action_buttons', 'logged_in');
