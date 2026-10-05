-- Split the /analysis-edit2 report summary/detail switch into an SDUI widget.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.reportToggle', 'WIDGET', '{"domId":"reportViewToggleSdui","widget":"report_view_toggle","className":"result-view-toggle analysis-report-toggle-widget"}', 'analysisEdit.root', NULL, 4, NULL, 'report_view_toggle', 'logged_in');
