-- Continue splitting /analysis-edit2 legacy markup into smaller SDUI widgets.
-- These widgets still reuse the existing analysis-edit2 runtime/state, but the
-- DOM ownership is now SDUI-driven instead of hard-coded in the fragment.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.costStructure', 'WIDGET', '{"domId":"costStructureSdui","widget":"cost_structure_table","className":"analysis-cost-structure-widget"}', 'analysisEdit.root', NULL, 1, NULL, 'cost_structure_table', 'logged_in'),
  ('analysis-edit', 'analysisEdit.resultContracts', 'WIDGET', '{"domId":"editResultContracts","widget":"result_contract_cards","className":"edit-result-contracts analysis-result-contracts-widget"}', 'analysisEdit.root', NULL, 2, NULL, 'result_contract_cards', 'logged_in'),
  ('analysis-edit', 'analysisEdit.evidenceViewer', 'WIDGET', '{"domId":"evidenceViewer","widget":"evidence_viewer","className":"evidence-viewer evidence-viewer-enhanced"}', 'analysisEdit.root', NULL, 3, NULL, 'evidence_viewer', 'logged_in');

UPDATE ui_metadata
SET order_index = 10,
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'analysis-edit'
  AND node_id = 'analysisEdit.fragment';
