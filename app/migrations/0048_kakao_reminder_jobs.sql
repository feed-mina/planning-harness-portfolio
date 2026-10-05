-- Add Kakao scheduled reminder controls to the time-settings SDUI page.

UPDATE ui_metadata
SET order_index=3
WHERE page_key='time-settings'
  AND node_id='time.integration.status';

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('time-settings', 'time.integration.reminders', 'GROUP', '{"className":"reminder-panel"}', 'time.integration.panel', 'COLUMN', 2, NULL, NULL, NULL),
  ('time-settings', 'time.integration.reminderLabel', 'TEXT', '{"as":"div","className":"field-label","text":"카카오 예약 알림"}', 'time.integration.reminders', NULL, 0, NULL, NULL, NULL),
  ('time-settings', 'time.integration.reminderHint', 'TEXT', '{"as":"p","className":"hint","text":"선택한 시간 전에 나에게 보내기 메시지로 일정 알림을 예약합니다."}', 'time.integration.reminders', NULL, 1, NULL, NULL, NULL),
  ('time-settings', 'time.integration.reminderRow', 'GROUP', '{"domId":"reminderMinuteRow","className":"weekday-row reminder-minute-row"}', 'time.integration.reminders', 'ROW', 2, NULL, NULL, NULL),
  ('time-settings', 'time.integration.reminder30', 'CHECKBOX', '{"className":"weekday-chip","variant":"plain","value":"30","label":"30분 전","checked":true}', 'time.integration.reminderRow', NULL, 0, NULL, NULL, NULL),
  ('time-settings', 'time.integration.reminder90', 'CHECKBOX', '{"className":"weekday-chip","variant":"plain","value":"90","label":"1시간 30분 전"}', 'time.integration.reminderRow', NULL, 1, NULL, NULL, NULL),
  ('time-settings', 'time.integration.reminder180', 'CHECKBOX', '{"className":"weekday-chip","variant":"plain","value":"180","label":"3시간 전"}', 'time.integration.reminderRow', NULL, 2, NULL, NULL, NULL),
  ('time-settings', 'time.integration.reminderAction', 'BUTTON', '{"domId":"btnScheduleKakaoReminders","className":"btn btn-primary","text":"예약 알림 등록","disabled":true}', 'time.integration.reminders', NULL, 3, 'SCHEDULE_KAKAO_REMINDERS', NULL, NULL);
