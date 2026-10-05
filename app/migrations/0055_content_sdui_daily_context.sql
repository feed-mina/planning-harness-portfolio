-- Issue #84: enrich content posts with SDUI context and daily-life fields.

ALTER TABLE content_posts ADD COLUMN project_id TEXT;
ALTER TABLE content_posts ADD COLUMN topic_id TEXT;
ALTER TABLE content_posts ADD COLUMN source_refs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE content_posts ADD COLUMN sleep_hours_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE content_posts ADD COLUMN daily_slots_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE content_posts ADD COLUMN emotion TEXT;

CREATE INDEX IF NOT EXISTS idx_content_posts_project
  ON content_posts (user_id, project_id, updated_at);

-- Replace the content page metadata with the issue #84 workspace.
DELETE FROM ui_metadata WHERE page_key='content';

INSERT INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('content', 'content.root', 'GROUP', '{"className":"sdui-root content-write-page"}', NULL, 'COLUMN', 0, NULL, NULL, NULL),
  ('content', 'content.title', 'TEXT', '{"as":"h1","text":"콘텐츠 작성"}', 'content.root', NULL, 0, NULL, NULL, NULL),
  ('content', 'content.lead', 'GROUP', '{"as":"p","className":"lead"}', 'content.root', 'ROW', 1, NULL, NULL, NULL),
  ('content', 'content.lead.text', 'TEXT', '{"as":"span","text":"분석·설계, 회의록과 일과 기록을 한 콘텐츠로 연결합니다. "}', 'content.lead', NULL, 0, NULL, NULL, NULL),
  ('content', 'content.lead.usage', 'TEXT', '{"as":"span","className":"usage-pill","text":"...","dataset":{"usage":""}}', 'content.lead', NULL, 1, NULL, NULL, NULL),

  ('content', 'content.guest', 'GROUP', '{"as":"section","domId":"guest","hidden":true}', 'content.root', 'COLUMN', 2, NULL, NULL, NULL),
  ('content', 'content.guest.login', 'TEXT', '{"as":"span","domId":"guestLogin","text":""}', 'content.guest', NULL, 0, NULL, NULL, NULL),

  ('content', 'content.member', 'GROUP', '{"as":"section","domId":"member","className":"content-write-shell","hidden":true}', 'content.root', 'COLUMN', 3, NULL, NULL, NULL),
  ('content', 'content.context', 'WIDGET', '{"className":"panel content-context-card"}', 'content.member', NULL, 0, NULL, 'content_context', NULL),
  ('content', 'content.workspace', 'GROUP', '{"className":"content-write-workspace"}', 'content.member', 'ROW', 1, NULL, NULL, NULL),

  ('content', 'content.editor', 'GROUP', '{"as":"section","className":"panel content-editor-card"}', 'content.workspace', 'COLUMN', 0, NULL, NULL, NULL),
  ('content', 'content.form.head', 'GROUP', '{"className":"result-head"}', 'content.editor', 'ROW', 0, NULL, NULL, NULL),
  ('content', 'content.form.title', 'TEXT', '{"as":"div","domId":"formTitle","className":"field-label","text":"새 콘텐츠"}', 'content.form.head', NULL, 0, NULL, NULL, NULL),
  ('content', 'content.form.new', 'BUTTON', '{"domId":"btnNewPost","className":"btn btn-ghost btn-small","text":"새 글"}', 'content.form.head', NULL, 1, 'NEW_CONTENT_POST', NULL, NULL),
  ('content', 'content.form.titleLabel', 'GROUP', '{"as":"label"}', 'content.editor', 'COLUMN', 1, NULL, NULL, NULL),
  ('content', 'content.form.titleText', 'TEXT', '{"as":"span","text":"제목"}', 'content.form.titleLabel', NULL, 0, NULL, NULL, NULL),
  ('content', 'content.form.titleInput', 'INPUT', '{"domId":"postTitle","inputType":"text","maxLength":180,"placeholder":"콘텐츠 제목을 입력하세요"}', 'content.form.titleLabel', NULL, 1, NULL, NULL, NULL),
  ('content', 'content.form.bodyLabel', 'TEXT', '{"as":"label","className":"field-label","text":"내용"}', 'content.editor', NULL, 2, NULL, NULL, NULL),
  ('content', 'content.form.bodyInput', 'TEXTAREA', '{"domId":"postBody","rows":14,"placeholder":"내용을 입력하세요"}', 'content.editor', NULL, 3, NULL, NULL, NULL),
  ('content', 'content.form.tags', 'WIDGET', '{"className":"content-tags-widget"}', 'content.editor', NULL, 4, NULL, 'content_tags', NULL),
  ('content', 'content.form.assets', 'WIDGET', '{"className":"content-assets-widget"}', 'content.editor', NULL, 5, NULL, 'content_assets', NULL),

  ('content', 'content.daily', 'GROUP', '{"as":"section","className":"panel content-daily-card"}', 'content.workspace', 'COLUMN', 1, NULL, NULL, NULL),
  ('content', 'content.daily.title', 'TEXT', '{"as":"div","className":"field-label content-section-title","text":"일과 관리"}', 'content.daily', NULL, 0, NULL, NULL, NULL),
  ('content', 'content.daily.sleep', 'WIDGET', '{"className":"sleep-carousel-widget"}', 'content.daily', NULL, 1, NULL, 'sleep_hour_carousel', NULL),
  ('content', 'content.daily.slots', 'WIDGET', '{"className":"daily-slots-widget"}', 'content.daily', NULL, 2, NULL, 'daily_slots', NULL),
  ('content', 'content.daily.emotion', 'WIDGET', '{"className":"emotion-widget"}', 'content.daily', NULL, 3, NULL, 'content_emotion', NULL),

  ('content', 'content.actions', 'GROUP', '{"className":"result-actions content-write-actions"}', 'content.member', 'ROW', 2, NULL, NULL, NULL),
  ('content', 'content.visibility', 'SELECT', '{"domId":"postVisibility","value":"private","ariaLabel":"공개 범위","options":[{"value":"private","label":"비공개"},{"value":"team","label":"팀"},{"value":"public","label":"공개"}]}', 'content.actions', NULL, 0, NULL, NULL, NULL),
  ('content', 'content.save', 'BUTTON', '{"domId":"btnSavePost","className":"btn btn-primary","text":"저장"}', 'content.actions', NULL, 1, 'SAVE_CONTENT_POST', NULL, NULL),
  ('content', 'content.delete', 'BUTTON', '{"domId":"btnDeletePost","className":"btn btn-ghost","text":"삭제","disabled":true}', 'content.actions', NULL, 2, 'DELETE_CONTENT_POST', NULL, NULL),
  ('content', 'content.status', 'TEXT', '{"as":"span","domId":"postStatus","className":"hint","text":""}', 'content.actions', NULL, 3, NULL, NULL, NULL),

  ('content', 'content.list.panel', 'GROUP', '{"as":"section","className":"panel content-list-card"}', 'content.member', 'COLUMN', 3, NULL, NULL, NULL),
  ('content', 'content.list.head', 'GROUP', '{"className":"result-head"}', 'content.list.panel', 'ROW', 0, NULL, NULL, NULL),
  ('content', 'content.list.label', 'TEXT', '{"as":"div","className":"field-label","text":"콘텐츠 목록"}', 'content.list.head', NULL, 0, NULL, NULL, NULL),
  ('content', 'content.list.reload', 'BUTTON', '{"domId":"btnReloadPosts","className":"btn btn-ghost btn-small","text":"새로고침"}', 'content.list.head', NULL, 1, 'LOAD_CONTENT_POSTS', NULL, NULL),
  ('content', 'content.list.body', 'GROUP', '{"domId":"postList","className":"post-list"}', 'content.list.panel', 'COLUMN', 1, NULL, NULL, NULL),
  ('content', 'content.assets.panel', 'GROUP', '{"domId":"assetPanel","className":"asset-panel","hidden":true}', 'content.list.panel', 'COLUMN', 2, NULL, NULL, NULL),
  ('content', 'content.assets.list', 'GROUP', '{"domId":"assetList","className":"asset-list"}', 'content.assets.panel', 'COLUMN', 0, NULL, NULL, NULL),
  ('content', 'content.foot', 'TEXT', '{"as":"p","className":"foot","text":"기획 하네스 루프"}', 'content.root', NULL, 4, NULL, NULL, NULL);
