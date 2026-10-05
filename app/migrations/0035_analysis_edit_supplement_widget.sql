-- Move the /analysis-edit2 supplemental URL/memo controls into a GitHub-only
-- SDUI widget. Google/Kakao sessions keep the simpler search-analysis inputs.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.supplementInput', 'WIDGET', '{"domId":"analysisSupplementSdui","widget":"analysis_supplement_input","className":"sub-block analysis-supplement-widget"}', 'analysisEdit.root', NULL, 6, NULL, 'analysis_supplement_input', 'provider:github');
