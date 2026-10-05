-- Clarify Google Calendar and Kakao notification integration limits in the SDUI time-settings panel.

UPDATE ui_metadata
SET props_json='{"as":"div","className":"field-label","text":"캘린더/카카오 알림 연결"}'
WHERE page_key='time-settings'
  AND node_id='time.integration.title';

UPDATE ui_metadata
SET order_index=2
WHERE page_key='time-settings'
  AND node_id='time.integration.actions';

UPDATE ui_metadata
SET order_index=3
WHERE page_key='time-settings'
  AND node_id='time.integration.reminders';

UPDATE ui_metadata
SET order_index=4
WHERE page_key='time-settings'
  AND node_id='time.integration.status';

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('time-settings', 'time.integration.guidance', 'TEXT', '{"as":"p","className":"hint integration-guidance","text":"Google Calendar 연결은 Google OAuth 테스트 사용자 또는 검증 완료 계정만 통과합니다. Kakao 알림은 메시지 권한 동의 후 나에게 보내기로 발송됩니다."}', 'time.integration.panel', NULL, 1, NULL, NULL, NULL);
