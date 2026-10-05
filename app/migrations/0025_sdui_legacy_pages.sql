-- SDUI metadata wrappers for legacy static pages.
-- The page shell is server-driven; each WIDGET loads the existing page body fragment.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('dashboard', 'dashboard.root', 'GROUP', '{"className":"sdui-root"}', NULL, 'COLUMN', 0, NULL, NULL, NULL),
  ('dashboard', 'dashboard.fragment', 'WIDGET', '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/dashboard.html"}', 'dashboard.root', NULL, 0, NULL, 'legacy_fragment', NULL),

  ('feature', 'feature.root', 'GROUP', '{"className":"sdui-root"}', NULL, 'COLUMN', 0, NULL, NULL, NULL),
  ('feature', 'feature.fragment', 'WIDGET', '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/feature.html"}', 'feature.root', NULL, 0, NULL, 'legacy_fragment', NULL),

  ('analysis', 'analysis.root', 'GROUP', '{"className":"sdui-root"}', NULL, 'COLUMN', 0, NULL, NULL, NULL),
  ('analysis', 'analysis.fragment', 'WIDGET', '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/analysis.html"}', 'analysis.root', NULL, 0, NULL, 'legacy_fragment', NULL),

  ('analysis-edit', 'analysisEdit.root', 'GROUP', '{"className":"sdui-root"}', NULL, 'COLUMN', 0, NULL, NULL, NULL),
  ('analysis-edit', 'analysisEdit.fragment', 'WIDGET', '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/analysis-edit2.html"}', 'analysisEdit.root', NULL, 0, NULL, 'legacy_fragment', NULL),

  ('mypage', 'mypage.root', 'GROUP', '{"className":"sdui-root"}', NULL, 'COLUMN', 0, NULL, NULL, NULL),
  ('mypage', 'mypage.fragment', 'WIDGET', '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/mypage.html"}', 'mypage.root', NULL, 0, NULL, 'legacy_fragment', NULL),

  ('stats', 'stats.root', 'GROUP', '{"className":"sdui-root"}', NULL, 'COLUMN', 0, NULL, NULL, NULL),
  ('stats', 'stats.fragment', 'WIDGET', '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/stats.html"}', 'stats.root', NULL, 0, NULL, 'legacy_fragment', NULL),

  ('ask-todo-hub', 'askTodo.root', 'GROUP', '{"className":"sdui-root"}', NULL, 'COLUMN', 0, NULL, NULL, NULL),
  ('ask-todo-hub', 'askTodo.fragment', 'WIDGET', '{"domId":"legacyPage","fragmentUrl":"/assets/sdui-fragments/ask-todo-hub.html"}', 'askTodo.root', NULL, 0, NULL, 'legacy_fragment', NULL);
