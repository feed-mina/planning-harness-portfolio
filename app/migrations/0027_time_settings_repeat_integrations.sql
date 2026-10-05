-- Add repeat schedule controls and integration entry points to the SDUI time-settings page.

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('time-settings', 'time.block.repeat', 'BUTTON', '{"domId":"btnRepeatBlock","className":"btn btn-ghost","text":"반복 일정","ariaLabel":"반복 일정 요일 선택 열기"}', 'time.block.actions', NULL, 1, 'TOGGLE_REPEAT_BLOCK', NULL, NULL),
  ('time-settings', 'time.block.status', 'TEXT', '{"as":"span","domId":"blockStatus","className":"hint","text":""}', 'time.block.actions', NULL, 2, NULL, NULL, NULL),

  ('time-settings', 'time.repeat.panel', 'GROUP', '{"as":"section","domId":"repeatPanel","className":"repeat-panel","hidden":true}', 'time.block.panel', 'COLUMN', 3, NULL, NULL, NULL),
  ('time-settings', 'time.repeat.title', 'TEXT', '{"as":"div","className":"field-label","text":"반복 요일"}', 'time.repeat.panel', NULL, 0, NULL, NULL, NULL),
  ('time-settings', 'time.repeat.hint', 'TEXT', '{"as":"p","className":"hint","text":"반복 일정으로 사용할 요일을 선택합니다."}', 'time.repeat.panel', NULL, 1, NULL, NULL, NULL),
  ('time-settings', 'time.repeat.row', 'GROUP', '{"domId":"repeatWeekdayRow","className":"weekday-row repeat-weekday-row"}', 'time.repeat.panel', 'ROW', 2, NULL, NULL, NULL),
  ('time-settings', 'time.repeat.mon', 'CHECKBOX', '{"className":"weekday-chip","variant":"plain","value":"1","label":"월","checked":true}', 'time.repeat.row', NULL, 0, NULL, NULL, NULL),
  ('time-settings', 'time.repeat.tue', 'CHECKBOX', '{"className":"weekday-chip","variant":"plain","value":"2","label":"화","checked":true}', 'time.repeat.row', NULL, 1, NULL, NULL, NULL),
  ('time-settings', 'time.repeat.wed', 'CHECKBOX', '{"className":"weekday-chip","variant":"plain","value":"3","label":"수","checked":true}', 'time.repeat.row', NULL, 2, NULL, NULL, NULL),
  ('time-settings', 'time.repeat.thu', 'CHECKBOX', '{"className":"weekday-chip","variant":"plain","value":"4","label":"목","checked":true}', 'time.repeat.row', NULL, 3, NULL, NULL, NULL),
  ('time-settings', 'time.repeat.fri', 'CHECKBOX', '{"className":"weekday-chip","variant":"plain","value":"5","label":"금","checked":true}', 'time.repeat.row', NULL, 4, NULL, NULL, NULL),
  ('time-settings', 'time.repeat.sat', 'CHECKBOX', '{"className":"weekday-chip","variant":"plain","value":"6","label":"토"}', 'time.repeat.row', NULL, 5, NULL, NULL, NULL),
  ('time-settings', 'time.repeat.sun', 'CHECKBOX', '{"className":"weekday-chip","variant":"plain","value":"0","label":"일"}', 'time.repeat.row', NULL, 6, NULL, NULL, NULL),
  ('time-settings', 'time.integration.title', 'TEXT', '{"as":"div","className":"field-label","text":"캘린더/알림 연결"}', 'time.repeat.panel', NULL, 3, NULL, NULL, NULL),
  ('time-settings', 'time.integration.actions', 'GROUP', '{"className":"integration-actions"}', 'time.repeat.panel', 'ROW', 4, NULL, NULL, NULL),
  ('time-settings', 'time.integration.google', 'BUTTON', '{"domId":"btnGoogleCalendarConnect","className":"btn btn-ghost","text":"구글 캘린더 연결"}', 'time.integration.actions', NULL, 0, 'CONNECT_GOOGLE_CALENDAR', NULL, NULL),
  ('time-settings', 'time.integration.kakao', 'BUTTON', '{"domId":"btnKakaoNoticeConnect","className":"btn btn-ghost","text":"카카오 메시지 알림 연결"}', 'time.integration.actions', NULL, 1, 'CONNECT_KAKAO_NOTICE', NULL, NULL),
  ('time-settings', 'time.integration.status', 'TEXT', '{"as":"p","domId":"integrationStatus","className":"hint","text":""}', 'time.repeat.panel', NULL, 5, NULL, NULL, NULL);
