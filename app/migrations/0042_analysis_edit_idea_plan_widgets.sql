-- Split /analysis-edit2 idea and plan execution shells into SDUI widgets.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.ideaShell', 'WIDGET', '{"domId":"ideaShellSdui","widget":"idea_shell"}', 'analysisEdit.root', NULL, 18, NULL, 'idea_shell', 'logged_in'),
  ('analysis-edit', 'analysisEdit.planShell', 'WIDGET', '{"domId":"planShellSdui","widget":"plan_shell"}', 'analysisEdit.root', NULL, 19, NULL, 'plan_shell', 'logged_in');
