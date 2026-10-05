-- Reframe time-settings around a simple current-time clock flow with manual range as an accordion.

UPDATE ui_metadata
SET props_json='{"as":"section","className":"panel time-block-panel time-quick-panel"}'
WHERE page_key='time-settings'
  AND node_id='time.block.panel';

UPDATE ui_metadata
SET props_json='{"className":"result-head time-quick-head"}'
WHERE page_key='time-settings'
  AND node_id='time.block.head';

UPDATE ui_metadata
SET props_json='{"className":"time-block-copy"}'
WHERE page_key='time-settings'
  AND node_id='time.block.copy';

UPDATE ui_metadata
SET props_json='{"as":"div","className":"field-label","text":"현재 시간 기준 목표 설정"}'
WHERE page_key='time-settings'
  AND node_id='time.block.label';

UPDATE ui_metadata
SET props_json='{"as":"label","className":"compact-label date-chip-label"}',
    parent_node_id='time.quick.meta',
    order_index=0
WHERE page_key='time-settings'
  AND node_id='time.block.dateLabel';

UPDATE ui_metadata
SET props_json='{"as":"label","className":"timezone-field quick-timezone"}',
    parent_node_id='time.quick.meta',
    order_index=1
WHERE page_key='time-settings'
  AND node_id='time.block.tzLabel';

UPDATE ui_metadata
SET props_json='{"as":"label","className":"quick-note-label"}',
    parent_node_id='time.quick.note',
    order_index=0
WHERE page_key='time-settings'
  AND node_id='time.block.noteLabel';

UPDATE ui_metadata
SET props_json='{"domId":"manualTimeInputs","className":"manual-time-inputs"}',
    parent_node_id='time.manual.panel',
    group_direction='ROW',
    order_index=1
WHERE page_key='time-settings'
  AND node_id='time.block.meta';

UPDATE ui_metadata
SET order_index=0
WHERE page_key='time-settings'
  AND node_id='time.block.startLabel';

UPDATE ui_metadata
SET order_index=1
WHERE page_key='time-settings'
  AND node_id='time.block.endLabel';

UPDATE ui_metadata
SET props_json='{"className":"time-action-bar"}',
    order_index=4
WHERE page_key='time-settings'
  AND node_id='time.block.actions';

UPDATE ui_metadata
SET parent_node_id='time.manual.panel',
    order_index=3
WHERE page_key='time-settings'
  AND node_id='time.repeat.panel';

UPDATE ui_metadata
SET props_json='{"domId":"btnAddBlock","className":"btn btn-primary time-save-button","text":"저장하기"}'
WHERE page_key='time-settings'
  AND node_id='time.block.add';

UPDATE ui_metadata
SET props_json='{"domId":"btnRepeatBlock","className":"btn btn-ghost btn-small","text":"반복 일정","ariaLabel":"반복 일정 요일 선택 열기"}',
    parent_node_id='time.manual.panel',
    order_index=2
WHERE page_key='time-settings'
  AND node_id='time.block.repeat';

UPDATE ui_metadata
SET props_json='{"as":"span","domId":"blockStatus","className":"hint time-save-status","text":""}',
    order_index=1
WHERE page_key='time-settings'
  AND node_id='time.block.status';

UPDATE ui_metadata
SET props_json='{"as":"section","className":"save-options-panel"}',
    parent_node_id='time.quick.right',
    order_index=0
WHERE page_key='time-settings'
  AND node_id='time.integration.panel';

UPDATE ui_metadata
SET props_json='{"as":"div","className":"field-label","text":"저장 옵션"}'
WHERE page_key='time-settings'
  AND node_id='time.integration.title';

UPDATE ui_metadata
SET props_json='{"className":"save-option-actions"}'
WHERE page_key='time-settings'
  AND node_id='time.integration.actions';

UPDATE ui_metadata
SET props_json='{"domId":"btnGoogleCalendarConnect","className":"btn btn-ghost btn-small","text":"구글 캘린더 연결"}'
WHERE page_key='time-settings'
  AND node_id='time.integration.google';

UPDATE ui_metadata
SET props_json='{"domId":"btnKakaoNoticeConnect","className":"btn btn-ghost btn-small","text":"카카오 메시지 연결"}'
WHERE page_key='time-settings'
  AND node_id='time.integration.kakao';

UPDATE ui_metadata
SET props_json='{"domId":"btnCreateGoogleCalendarEvent","className":"btn btn-ghost btn-small","text":"캘린더 추가","disabled":true}'
WHERE page_key='time-settings'
  AND node_id='time.integration.googleAdd';

UPDATE ui_metadata
SET props_json='{"domId":"btnSendKakaoNotice","className":"btn btn-ghost btn-small","text":"테스트 알림","disabled":true}'
WHERE page_key='time-settings'
  AND node_id='time.integration.kakaoSend';

UPDATE ui_metadata
SET props_json='{"domId":"btnScheduleKakaoReminders","className":"btn btn-primary btn-small","text":"예약 알림 등록","disabled":true}'
WHERE page_key='time-settings'
  AND node_id='time.integration.reminderAction';

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('time-settings', 'time.quick.layout', 'GROUP', '{"domId":"timeQuickLayout","className":"time-quick-layout"}', 'time.block.panel', 'ROW', 1, NULL, NULL, NULL),
  ('time-settings', 'time.quick.left', 'GROUP', '{"className":"time-quick-left"}', 'time.quick.layout', 'COLUMN', 0, NULL, NULL, NULL),
  ('time-settings', 'time.quick.right', 'GROUP', '{"className":"time-quick-right"}', 'time.quick.layout', 'COLUMN', 1, NULL, NULL, NULL),

  ('time-settings', 'time.quick.clockCard', 'GROUP', '{"className":"time-clock-card"}', 'time.quick.left', 'COLUMN', 0, NULL, NULL, NULL),
  ('time-settings', 'time.quick.clockLabel', 'TEXT', '{"as":"div","className":"time-clock-label","text":"현재 시간"}', 'time.quick.clockCard', NULL, 0, NULL, NULL, NULL),
  ('time-settings', 'time.quick.clockBody', 'GROUP', '{"className":"time-clock-body"}', 'time.quick.clockCard', 'ROW', 1, NULL, NULL, NULL),
  ('time-settings', 'time.quick.clockFace', 'GROUP', '{"domId":"currentClockFace","className":"time-clock-face","ariaLabel":"현재 시간 시계"}', 'time.quick.clockBody', 'COLUMN', 0, NULL, NULL, NULL),
  ('time-settings', 'time.quick.clockCopy', 'GROUP', '{"className":"time-clock-copy"}', 'time.quick.clockBody', 'COLUMN', 1, NULL, NULL, NULL),
  ('time-settings', 'time.quick.currentText', 'TEXT', '{"as":"div","domId":"currentTimeText","className":"time-current-text","text":"오전 10:52"}', 'time.quick.clockCopy', NULL, 0, NULL, NULL, NULL),
  ('time-settings', 'time.quick.currentHint', 'TEXT', '{"as":"p","className":"hint","text":"지금 기준으로 목표 시간을 빠르게 정합니다."}', 'time.quick.clockCopy', NULL, 1, NULL, NULL, NULL),

  ('time-settings', 'time.quick.controls', 'GROUP', '{"className":"time-quick-controls"}', 'time.quick.left', 'COLUMN', 1, NULL, NULL, NULL),
  ('time-settings', 'time.quick.buttons', 'GROUP', '{"className":"time-quick-buttons"}', 'time.quick.controls', 'ROW', 0, NULL, NULL, NULL),
  ('time-settings', 'time.quick.plus10', 'BUTTON', '{"className":"btn btn-ghost btn-small","text":"+10분","dataset":{"quickMinutes":"10"}}', 'time.quick.buttons', NULL, 0, 'SET_QUICK_DURATION', NULL, NULL),
  ('time-settings', 'time.quick.plus30', 'BUTTON', '{"className":"btn btn-ghost btn-small","text":"+30분","dataset":{"quickMinutes":"30"}}', 'time.quick.buttons', NULL, 1, 'SET_QUICK_DURATION', NULL, NULL),
  ('time-settings', 'time.quick.plus60', 'BUTTON', '{"className":"btn btn-ghost btn-small","text":"+1시간","dataset":{"quickMinutes":"60"}}', 'time.quick.buttons', NULL, 2, 'SET_QUICK_DURATION', NULL, NULL),
  ('time-settings', 'time.quick.plus180', 'BUTTON', '{"className":"btn btn-ghost btn-small","text":"+3시간","dataset":{"quickMinutes":"180"}}', 'time.quick.buttons', NULL, 3, 'SET_QUICK_DURATION', NULL, NULL),
  ('time-settings', 'time.quick.target', 'GROUP', '{"className":"time-target-row"}', 'time.quick.controls', 'ROW', 1, NULL, NULL, NULL),
  ('time-settings', 'time.quick.targetText', 'TEXT', '{"as":"strong","domId":"targetTimeText","className":"time-target-pill","text":"목표 시간 오전 11:22"}', 'time.quick.target', NULL, 0, NULL, NULL, NULL),
  ('time-settings', 'time.quick.targetMode', 'TEXT', '{"as":"span","domId":"targetModeText","className":"time-target-mode","text":"+30분 후"}', 'time.quick.target', NULL, 1, NULL, NULL, NULL),
  ('time-settings', 'time.quick.dateSummary', 'TEXT', '{"as":"span","domId":"dateSummaryText","className":"time-date-pill","text":"오늘"}', 'time.quick.target', NULL, 2, NULL, NULL, NULL),

  ('time-settings', 'time.quick.meta', 'GROUP', '{"className":"time-quick-meta"}', 'time.quick.right', 'COLUMN', 1, NULL, NULL, NULL),
  ('time-settings', 'time.quick.note', 'GROUP', '{"className":"time-quick-note"}', 'time.quick.left', 'COLUMN', 2, NULL, NULL, NULL),

  ('time-settings', 'time.manual.fold', 'GROUP', '{"className":"manual-time-fold"}', 'time.block.panel', 'ROW', 2, NULL, NULL, NULL),
  ('time-settings', 'time.manual.toggle', 'BUTTON', '{"domId":"btnManualTimeToggle","className":"manual-time-toggle","text":"시작·종료 시간 직접 지정","ariaLabel":"시작 종료 시간 직접 지정 열기"}', 'time.manual.fold', NULL, 0, 'TOGGLE_MANUAL_TIME', NULL, NULL),
  ('time-settings', 'time.manual.summary', 'TEXT', '{"as":"span","domId":"manualTimeSummary","className":"manual-time-summary","text":"오전 09:00 - 오전 10:00"}', 'time.manual.fold', NULL, 1, NULL, NULL, NULL),
  ('time-settings', 'time.manual.panel', 'GROUP', '{"domId":"manualTimePanel","className":"manual-time-panel","hidden":true}', 'time.block.panel', 'COLUMN', 3, NULL, NULL, NULL),
  ('time-settings', 'time.manual.hint', 'TEXT', '{"as":"p","className":"hint","text":"정확한 시작·종료 시간이 필요할 때만 직접 입력합니다."}', 'time.manual.panel', NULL, 0, NULL, NULL, NULL);
