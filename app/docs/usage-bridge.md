# 로컬 브리지 수집기 (usage-bridge)

> Issue #162. Claude/Codex 구독 잔여량은 공개 API가 없어(조사: `outputs/2026-07-20/adapter-research.md`)
> **본인 로컬 환경에서** 읽어 서버에 push 하는 것이 유일한 자동화 경로다. 이 스크립트는
> `PUT /api/agent-subscriptions/{provider}/windows/{kind}` 에 `source=local_bridge` 로 관측값을 보낸다.

## 준비

1. 마이페이지에서 해당 제공자(claude/codex)의 **구독 정보를 먼저 저장**한다 (없으면 서버가 409로 거절).
2. 인증 방법 중 하나를 준비한다 — 브리지는 자격증명을 어디에도 저장·전송하지 않는다(요청 헤더에만 사용):
   - `HARNESS_TOKEN`: 모바일 인증으로 발급된 Bearer access token
   - `HARNESS_SID`: 브라우저에서 본인이 직접 복사한 `sid` 쿠키 값 (본인 세션, 만료 시 재복사)
3. `HARNESS_BASE_URL`: 앱 주소 (예: `https://harness-meeting-app.kibayerin.workers.dev`)

## 사용법

```bash
# Claude — Claude Code에서 /usage 실행 후 화면 텍스트를 붙여넣는다
node app/scripts/usage-bridge.mjs claude --paste
# (텍스트 붙여넣고 Ctrl-D)

# Codex — 로컬 세션 파일(~/.codex/sessions)의 최신 rate_limits 스냅샷을 읽는다
node app/scripts/usage-bridge.mjs codex

# Codex — /status 화면 텍스트 붙여넣기 방식
node app/scripts/usage-bridge.mjs codex --paste

# 전송 없이 파싱 결과만 확인
node app/scripts/usage-bridge.mjs codex --dry-run

# 리셋 시각이 파싱되지 않을 때 직접 지정 (ISO)
node app/scripts/usage-bridge.mjs claude --paste --resets-weekly 2026-07-24T00:00:00Z
```

## 동작 원칙 (이슈 #162 인수조건)

- **베스트에포트**: 파싱이 불확실하면(윈도우 미식별, % 범위 밖, 알 수 없는 window_minutes) 해당 윈도우를
  push 하지 않는다. 리셋 시각을 확정할 수 없으면 그 윈도우는 생략하고 `--resets-*` 지정을 안내한다.
- **기존 값 오염 금지**: 서버의 `observed_at` 조건부 upsert 덕에 더 오래된 관측은 자동 무시된다.
  파싱 실패 시에는 아무 요청도 보내지 않는다.
- **페이로드 최소화**: 전송되는 것은 잔여 %·한도(100)·단위·리셋/관측 시각뿐이다. CLI 원문 출력,
  대화 내용, 자격증명은 전송하지 않는다 (서버도 token/cookie 류 필드를 400으로 거절한다).

## 파서가 인식하는 형태

- **텍스트(붙여넣기)**: "session/5-hour/5시간" 또는 "week/주간" 이 들어간 줄 근처의 `N% used|remaining|남음`.
  리셋은 ISO 시각, `resets 3pm`, `resets Thu 9am` 형태를 다음 발생 시점으로 해석한다.
- **codex 세션 파일**: rollout JSONL의 `rate_limits.primary/secondary` (`used_percent`,
  `window_minutes` ≈300→rolling_5h / ≈10080→weekly, `resets_in_seconds`). CLI 업데이트로 포맷이
  바뀌면 파싱을 포기하고 종료 코드 2로 알린다 — 그때는 `--paste` 방식을 사용한다.

## 정기 실행 (선택)

수동 실행이 1급 경로다. 자동화하려면 로컬 스케줄러(예: Windows 예약 작업 — ASK/Todo Hub #140 패턴,
macOS launchd, cron)에 위 명령을 등록한다. codex는 세션 파일 기반이라 비대화형 실행이 가능하고,
claude는 `/usage` 텍스트가 필요해 대화형 실행만 가능하다.
