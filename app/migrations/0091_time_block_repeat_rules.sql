-- 시간 설정 반복 일정 규칙 저장
-- 그동안 클라이언트가 보낸 repeat_weekdays 를 서버가 버려서, 반복 요일에는 블록이 보이지 않았다.
-- 규칙을 이 테이블에 저장하고 조회 시점에 해당 날짜의 요일로 확장한다.
-- 적용: wrangler d1 migrations apply harness-meeting-db [--local|--remote]

CREATE TABLE IF NOT EXISTS user_time_block_rules (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  weekdays_json TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'available'
                 CHECK (kind IN ('available', 'busy', 'focus', 'meeting')),
  note         TEXT,
  starts_on    TEXT NOT NULL,
  ends_on      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_time_block_rules_user
  ON user_time_block_rules (user_id, starts_on);

-- 특정 날짜만 반복에서 제외 (규칙 전체를 지우지 않고 하루만 건너뛰기)
CREATE TABLE IF NOT EXISTS user_time_block_rule_skips (
  rule_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  date       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (rule_id, date),
  FOREIGN KEY (rule_id) REFERENCES user_time_block_rules (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_time_block_rule_skips_user_date
  ON user_time_block_rule_skips (user_id, date);
