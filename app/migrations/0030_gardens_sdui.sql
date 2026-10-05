-- Garden management MVP for issue #71.
-- Stores per-repository Quartz garden configuration and seeds the SDUI page.

CREATE TABLE IF NOT EXISTS gardens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  title TEXT NOT NULL,
  config_json TEXT NOT NULL,
  deploy_target TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'draft',
  site_url TEXT,
  last_build_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, repo)
);

CREATE INDEX IF NOT EXISTS idx_gardens_user_updated
  ON gardens (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS garden_builds (
  id TEXT PRIMARY KEY,
  garden_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  artifact_url TEXT,
  site_url TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (garden_id) REFERENCES gardens(id)
);

CREATE INDEX IF NOT EXISTS idx_garden_builds_garden_started
  ON garden_builds (garden_id, started_at DESC);

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('garden', 'garden.root', 'GROUP', '{"className":"sdui-root"}', NULL, 'COLUMN', 0, NULL, NULL, NULL),
  ('garden', 'garden.title', 'TEXT', '{"as":"h1","text":"Garden 지식베이스"}', 'garden.root', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.lead', 'TEXT', '{"as":"p","className":"lead","text":"GitHub repo별 Quartz 지식베이스 설정을 만들고 build-garden 실행 지점을 관리합니다."}', 'garden.root', NULL, 1, NULL, NULL, NULL),

  ('garden', 'garden.guest', 'GROUP', '{"as":"section","domId":"guest","className":"panel","hidden":true}', 'garden.root', 'COLUMN', 2, NULL, NULL, NULL),
  ('garden', 'garden.guest.row', 'GROUP', '{"className":"empty-login"}', 'garden.guest', 'ROW', 0, NULL, NULL, NULL),
  ('garden', 'garden.guest.copy', 'TEXT', '{"as":"p","className":"hint","text":"Garden 관리는 로그인 후 사용할 수 있습니다."}', 'garden.guest.row', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.guest.login', 'TEXT', '{"as":"span","domId":"guestLogin","text":""}', 'garden.guest.row', NULL, 1, NULL, NULL, NULL),

  ('garden', 'garden.member', 'GROUP', '{"as":"section","domId":"member","className":"kmovement-layout","hidden":true}', 'garden.root', 'ROW', 3, NULL, NULL, NULL),

  ('garden', 'garden.form.panel', 'GROUP', '{"as":"section","className":"panel"}', 'garden.member', 'COLUMN', 0, NULL, NULL, NULL),
  ('garden', 'garden.form.head', 'GROUP', '{"className":"result-head"}', 'garden.form.panel', 'ROW', 0, NULL, NULL, NULL),
  ('garden', 'garden.form.copy', 'GROUP', '{}', 'garden.form.head', 'COLUMN', 0, NULL, NULL, NULL),
  ('garden', 'garden.form.label', 'TEXT', '{"as":"div","className":"field-label","text":"Garden 설정"}', 'garden.form.copy', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.form.hint', 'TEXT', '{"as":"p","className":"hint","text":"repo, 공개 label, taxonomy를 저장하면 garden.config.yaml 미리보기가 생성됩니다."}', 'garden.form.copy', NULL, 1, NULL, NULL, NULL),
  ('garden', 'garden.form.new', 'BUTTON', '{"domId":"btnNewGarden","className":"btn btn-ghost btn-small","text":"새 Garden"}', 'garden.form.head', NULL, 1, 'NEW_GARDEN_FORM', NULL, NULL),

  ('garden', 'garden.form.repoLabel', 'GROUP', '{"as":"label"}', 'garden.form.panel', 'COLUMN', 1, NULL, NULL, NULL),
  ('garden', 'garden.form.repoText', 'TEXT', '{"as":"span","text":"GitHub repo"}', 'garden.form.repoLabel', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.form.repoInput', 'SELECT', '{"domId":"gardenRepo","options":[{"value":"","label":"repo 목록을 불러오는 중"}]}', 'garden.form.repoLabel', NULL, 1, NULL, 'github_repos', NULL),

  ('garden', 'garden.form.meta', 'GROUP', '{"className":"meta-grid"}', 'garden.form.panel', 'ROW', 2, NULL, NULL, NULL),
  ('garden', 'garden.form.titleLabel', 'GROUP', '{"as":"label"}', 'garden.form.meta', 'COLUMN', 0, NULL, NULL, NULL),
  ('garden', 'garden.form.titleText', 'TEXT', '{"as":"span","text":"사이트 제목"}', 'garden.form.titleLabel', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.form.titleInput', 'INPUT', '{"domId":"gardenTitle","inputType":"text","maxLength":140,"placeholder":"업무 지식베이스"}', 'garden.form.titleLabel', NULL, 1, NULL, NULL, NULL),
  ('garden', 'garden.form.labelLabel', 'GROUP', '{"as":"label"}', 'garden.form.meta', 'COLUMN', 1, NULL, NULL, NULL),
  ('garden', 'garden.form.labelText', 'TEXT', '{"as":"span","text":"공개 기준 label"}', 'garden.form.labelLabel', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.form.labelInput', 'INPUT', '{"domId":"gardenPublishLabel","inputType":"text","value":"audience:business"}', 'garden.form.labelLabel', NULL, 1, NULL, NULL, NULL),
  ('garden', 'garden.form.pathLabel', 'GROUP', '{"as":"label"}', 'garden.form.meta', 'COLUMN', 2, NULL, NULL, NULL),
  ('garden', 'garden.form.pathText', 'TEXT', '{"as":"span","text":"Issues 경로"}', 'garden.form.pathLabel', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.form.pathInput', 'INPUT', '{"domId":"gardenIssuesDir","inputType":"text","value":"Knowledge/Issues"}', 'garden.form.pathLabel', NULL, 1, NULL, NULL, NULL),
  ('garden', 'garden.form.targetLabel', 'GROUP', '{"as":"label"}', 'garden.form.meta', 'COLUMN', 3, NULL, NULL, NULL),
  ('garden', 'garden.form.targetText', 'TEXT', '{"as":"span","text":"배포 대상"}', 'garden.form.targetLabel', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.form.targetInput', 'SELECT', '{"domId":"gardenDeployTarget","value":"manual","options":[{"value":"manual","label":"수동/preview"},{"value":"cloudflare_pages","label":"Cloudflare Pages"},{"value":"github_pages","label":"GitHub Pages"}]}', 'garden.form.targetLabel', NULL, 1, NULL, NULL, NULL),
  ('garden', 'garden.form.baseLabel', 'GROUP', '{"as":"label"}', 'garden.form.meta', 'COLUMN', 4, NULL, NULL, NULL),
  ('garden', 'garden.form.baseText', 'TEXT', '{"as":"span","text":"base URL"}', 'garden.form.baseLabel', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.form.baseInput', 'INPUT', '{"domId":"gardenBaseUrl","inputType":"text","placeholder":"quartz-project.pages.dev"}', 'garden.form.baseLabel', NULL, 1, NULL, NULL, NULL),
  ('garden', 'garden.form.logoLabel', 'GROUP', '{"as":"label"}', 'garden.form.meta', 'COLUMN', 5, NULL, NULL, NULL),
  ('garden', 'garden.form.logoText', 'TEXT', '{"as":"span","text":"logo path"}', 'garden.form.logoLabel', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.form.logoInput', 'INPUT', '{"domId":"gardenLogo","inputType":"text","placeholder":"/assets/logo.png"}', 'garden.form.logoLabel', NULL, 1, NULL, NULL, NULL),

  ('garden', 'garden.taxonomy', 'WIDGET', '{"domId":"taxonomyEditor","widget":"taxonomy_editor"}', 'garden.form.panel', NULL, 3, NULL, 'taxonomy_editor', NULL),
  ('garden', 'garden.form.actions', 'GROUP', '{"className":"result-actions"}', 'garden.form.panel', 'ROW', 4, NULL, NULL, NULL),
  ('garden', 'garden.form.save', 'BUTTON', '{"domId":"btnSaveGarden","className":"btn btn-primary","text":"설정 저장"}', 'garden.form.actions', NULL, 0, 'SAVE_GARDEN_CONFIG', NULL, NULL),
  ('garden', 'garden.form.build', 'BUTTON', '{"domId":"btnRunGardenBuild","className":"btn btn-ghost","text":"빌드 요청","disabled":true}', 'garden.form.actions', NULL, 1, 'RUN_GARDEN_BUILD', NULL, NULL),
  ('garden', 'garden.form.status', 'TEXT', '{"as":"span","domId":"gardenStatus","className":"hint","text":""}', 'garden.form.actions', NULL, 2, NULL, NULL, NULL),

  ('garden', 'garden.list.panel', 'GROUP', '{"as":"section","className":"panel"}', 'garden.member', 'COLUMN', 1, NULL, NULL, NULL),
  ('garden', 'garden.list.head', 'GROUP', '{"className":"result-head"}', 'garden.list.panel', 'ROW', 0, NULL, NULL, NULL),
  ('garden', 'garden.list.copy', 'GROUP', '{}', 'garden.list.head', 'COLUMN', 0, NULL, NULL, NULL),
  ('garden', 'garden.list.label', 'TEXT', '{"as":"div","className":"field-label","text":"Garden 목록"}', 'garden.list.copy', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.list.hint', 'TEXT', '{"as":"p","className":"hint","text":"저장된 repo별 지식베이스 설정입니다."}', 'garden.list.copy', NULL, 1, NULL, NULL, NULL),
  ('garden', 'garden.list.reload', 'BUTTON', '{"domId":"btnReloadGardens","className":"btn btn-ghost btn-small","text":"새로고침"}', 'garden.list.head', NULL, 1, 'LOAD_GARDENS', NULL, NULL),
  ('garden', 'garden.list.body', 'WIDGET', '{"domId":"gardenList","className":"post-list","widget":"garden_list"}', 'garden.list.panel', NULL, 1, NULL, 'garden_list', NULL),
  ('garden', 'garden.builds', 'WIDGET', '{"domId":"gardenBuilds","className":"asset-panel","widget":"garden_builds"}', 'garden.list.panel', NULL, 2, NULL, 'garden_builds', NULL),

  ('garden', 'garden.preview.panel', 'GROUP', '{"as":"section","className":"panel"}', 'garden.root', 'COLUMN', 4, NULL, NULL, NULL),
  ('garden', 'garden.preview.head', 'GROUP', '{"className":"result-head"}', 'garden.preview.panel', 'ROW', 0, NULL, NULL, NULL),
  ('garden', 'garden.preview.label', 'TEXT', '{"as":"div","className":"field-label","text":"garden.config.yaml preview"}', 'garden.preview.head', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.preview.refresh', 'BUTTON', '{"domId":"btnPreviewGardenConfig","className":"btn btn-ghost btn-small","text":"미리보기 갱신"}', 'garden.preview.head', NULL, 1, 'PREVIEW_GARDEN_CONFIG', NULL, NULL),
  ('garden', 'garden.preview.body', 'WIDGET', '{"domId":"gardenConfigPreviewWrap","widget":"config_preview"}', 'garden.preview.panel', NULL, 1, NULL, 'config_preview', NULL),
  ('garden', 'garden.foot', 'TEXT', '{"as":"p","className":"foot","text":"Planning Harness Garden"}', 'garden.root', NULL, 5, NULL, NULL, NULL);
