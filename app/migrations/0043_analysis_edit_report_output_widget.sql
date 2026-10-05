-- Split the /analysis-edit2 final report output shell into an SDUI widget.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.reportOutput', 'WIDGET', '{"domId":"reportOutputShellSdui","widget":"report_output_shell"}', 'analysisEdit.root', NULL, 20, NULL, 'report_output_shell', 'logged_in');
