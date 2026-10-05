-- Split the /analysis-edit2 6-A cost upload shell into an SDUI widget.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.costUpload', 'WIDGET', '{"domId":"costUploadShellSdui","widget":"cost_upload_shell"}', 'analysisEdit.root', NULL, 12, NULL, 'cost_upload_shell', 'logged_in');
