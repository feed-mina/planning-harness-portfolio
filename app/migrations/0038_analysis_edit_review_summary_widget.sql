-- Split the /analysis-edit2 KPI/action-summary shell into an SDUI widget.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.reviewSummary', 'WIDGET', '{"domId":"editReviewSummarySdui","widget":"edit_review_summary"}', 'analysisEdit.root', NULL, 10, NULL, 'edit_review_summary', 'logged_in');

UPDATE ui_metadata
SET order_index = 30,
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'analysis-edit'
  AND node_id = 'analysisEdit.fragment';
