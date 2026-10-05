ALTER TABLE garden_builds ADD COLUMN package_sha256 TEXT;
ALTER TABLE garden_builds ADD COLUMN pages_project_name TEXT;

CREATE INDEX IF NOT EXISTS idx_garden_builds_user_started
  ON garden_builds (user_id, started_at DESC);

-- Re-open Garden to every authenticated provider. The client still shows a login panel to guests.
UPDATE ui_metadata
SET allowed_roles = NULL, updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'garden';

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('garden', 'garden.guest', 'GROUP', '{"as":"section","domId":"guest","className":"panel","hidden":true}', 'garden.root', 'COLUMN', 2, NULL, NULL, NULL),
  ('garden', 'garden.guest.row', 'GROUP', '{"className":"empty-login"}', 'garden.guest', 'ROW', 0, NULL, NULL, NULL),
  ('garden', 'garden.guest.copy', 'TEXT', '{"as":"p","className":"hint","text":"Garden 생성과 배포는 로그인 후 사용할 수 있습니다."}', 'garden.guest.row', NULL, 0, NULL, NULL, NULL),
  ('garden', 'garden.guest.login', 'TEXT', '{"as":"span","domId":"guestLogin","text":""}', 'garden.guest.row', NULL, 1, NULL, NULL, NULL);

UPDATE ui_metadata
SET props_json='{"as":"p","className":"lead","text":"분석자료와 회의록을 선택해 누구나 공유 가능한 지식 페이지를 만듭니다."}',
    updated_at=CURRENT_TIMESTAMP
WHERE page_key='garden' AND node_id='garden.lead';

UPDATE ui_metadata
SET props_json='{"as":"p","className":"hint","text":"분석자료·회의록을 선택하고 제목을 입력하면 Cloudflare Pages 배포 준비가 완료됩니다."}',
    updated_at=CURRENT_TIMESTAMP
WHERE page_key='garden' AND node_id='garden.form.hint';
