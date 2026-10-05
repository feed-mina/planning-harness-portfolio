-- Split the /analysis-edit2 review filter buttons into an SDUI widget.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.reviewFilters', 'WIDGET', '{"domId":"reviewFilterControlsSdui","widget":"review_filter_controls","className":"review-filter-actions"}', 'analysisEdit.root', NULL, 9, NULL, 'review_filter_controls', 'logged_in');
