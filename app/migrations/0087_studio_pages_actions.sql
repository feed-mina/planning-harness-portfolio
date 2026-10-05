-- Add API-driven action metadata for Studio page fragments.
ALTER TABLE studio_page_fragments
  ADD COLUMN fragment_actions TEXT;

UPDATE studio_page_fragments
SET fragment_actions = '[]'
WHERE fragment_actions IS NULL;

UPDATE studio_page_fragments
SET
  fragment_html = REPLACE(fragment_html, '<button type="button">Save Branding</button>', '<button type="button" data-studio-action="save-branding">Save Branding</button>'),
  fragment_actions = '[{"action":"save-branding","type":"toast","message":"브랜딩 저장은 데모 화면이라 즉시 반영되지 않습니다."}]'
WHERE page_slug = 'branding' AND fragment_order = 0;

UPDATE studio_page_fragments
SET
  fragment_html = REPLACE(fragment_html, '<button type="button">Download JSON</button>', '<button type="button" data-studio-action="operations-download-json">Download JSON</button>'),
  fragment_actions = '[{"action":"operations-download-json","type":"download-json","filename":"studio-operations.json","message":"운영 기록 JSON 파일이 다운로드되었습니다.","payload":{"source":"operations","generatedAt":"timestamp"}}]'
WHERE page_slug = 'operations' AND fragment_order = 0;

UPDATE studio_page_fragments
SET
  fragment_html = REPLACE(fragment_html, '<button type="button">Change plan</button>', '<button type="button" data-studio-action="plans-change-plan">Change plan</button>'),
  fragment_html = REPLACE(fragment_html, '<button type="button">Revoke lease</button>', '<button type="button" data-studio-action="plans-revoke-lease">Revoke lease</button>'),
  fragment_actions = '[{"action":"plans-change-plan","type":"toast","message":"요금제 변경 요청이 접수되었습니다."},{"action":"plans-revoke-lease","type":"confirm","confirmMessage":"임대를 해지하시겠습니까?","message":"임대 해지 요청이 접수되었습니다."}]'
WHERE page_slug = 'plans' AND fragment_order = 0;
