-- Add live Google Calendar and Kakao message actions to the time-settings SDUI panel.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('time-settings', 'time.integration.google', 'BUTTON', '{"domId":"btnGoogleCalendarConnect","className":"btn btn-ghost","text":"구글 캘린더 연결"}', 'time.integration.actions', NULL, 0, 'CONNECT_GOOGLE_CALENDAR', NULL, NULL),
  ('time-settings', 'time.integration.kakao', 'BUTTON', '{"domId":"btnKakaoNoticeConnect","className":"btn btn-ghost","text":"카카오 메시지 알림 연결"}', 'time.integration.actions', NULL, 1, 'CONNECT_KAKAO_NOTICE', NULL, NULL),
  ('time-settings', 'time.integration.googleAdd', 'BUTTON', '{"domId":"btnCreateGoogleCalendarEvent","className":"btn btn-primary","text":"캘린더에 일정 추가","disabled":true}', 'time.integration.actions', NULL, 2, 'CREATE_GOOGLE_CALENDAR_EVENT', NULL, NULL),
  ('time-settings', 'time.integration.kakaoSend', 'BUTTON', '{"domId":"btnSendKakaoNotice","className":"btn btn-primary","text":"카카오 테스트 알림","disabled":true}', 'time.integration.actions', NULL, 3, 'SEND_KAKAO_NOTICE', NULL, NULL),
  ('time-settings', 'time.integration.status', 'TEXT', '{"as":"p","domId":"integrationStatus","className":"hint","text":""}', 'time.repeat.panel', NULL, 5, NULL, NULL, NULL);
