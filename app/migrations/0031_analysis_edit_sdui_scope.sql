-- Move the first /analysis-edit2 input block from the legacy fragment into a
-- smaller SDUI widget node. The legacy fragment remains for the rest of the
-- large workflow while we split it by phases.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.scopeInput', 'WIDGET', '{"domId":"analysisScopeSdui","widget":"analysis_scope_input","className":"analysis-sdui-scope"}', 'analysisEdit.root', NULL, 0, NULL, 'analysis_scope_input', 'logged_in');

UPDATE ui_metadata
SET order_index = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'analysis-edit'
  AND node_id = 'analysisEdit.fragment';
