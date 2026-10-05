-- Provider-aware SDUI split for /analysis-edit2.
-- GitHub-only controls should not be sent to Google/Kakao sessions.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.fileUploader', 'WIDGET', '{"domId":"analysisFileUploaderSdui","widget":"analysis_file_uploader","className":"sub-block analysis-file-uploader-widget"}', 'analysisEdit.root', NULL, 5, NULL, 'analysis_file_uploader', 'provider:github');
