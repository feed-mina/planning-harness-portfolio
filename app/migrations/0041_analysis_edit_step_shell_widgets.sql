-- Split /analysis-edit2 6-B through 6-F execution shells into SDUI widgets.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('analysis-edit', 'analysisEdit.boardShell', 'WIDGET', '{"domId":"boardSummaryShellSdui","widget":"board_summary_shell"}', 'analysisEdit.root', NULL, 13, NULL, 'board_summary_shell', 'logged_in'),
  ('analysis-edit', 'analysisEdit.heuristicShell', 'WIDGET', '{"domId":"heuristicShellSdui","widget":"heuristic_shell"}', 'analysisEdit.root', NULL, 14, NULL, 'heuristic_shell', 'logged_in'),
  ('analysis-edit', 'analysisEdit.deepReportShell', 'WIDGET', '{"domId":"deepReportShellSdui","widget":"deep_report_shell"}', 'analysisEdit.root', NULL, 15, NULL, 'deep_report_shell', 'logged_in'),
  ('analysis-edit', 'analysisEdit.evidenceMappingShell', 'WIDGET', '{"domId":"evidenceMappingShellSdui","widget":"evidence_mapping_shell"}', 'analysisEdit.root', NULL, 16, NULL, 'evidence_mapping_shell', 'logged_in'),
  ('analysis-edit', 'analysisEdit.validationShell', 'WIDGET', '{"domId":"validationShellSdui","widget":"validation_shell"}', 'analysisEdit.root', NULL, 17, NULL, 'validation_shell', 'logged_in');
