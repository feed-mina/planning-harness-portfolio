# NBlog 이슈 #18 배포·운영 런북

## 범위와 안전 경계

이 릴리스는 로컬 MVP 산출물을 Cloudflare 운영 계층에서 조회·검증·승인하고, 승인된 특정 산출물 버전을 브라우저 발행 도우미에 인계하는 계약까지만 포함한다.

- Cloudflare Worker는 사용자 PC의 `source/` 폴더나 네이버 로그인 세션을 직접 읽지 않는다.
- 네이버 비밀번호, 쿠키, 브라우저 프로필은 D1·R2·로그에 저장하지 않는다.
- 브라우저 인계 토큰은 10분 이내의 일회성 claim 토큰이며 최초 연결 때 세션 토큰으로 회전한다.
- 자동 발행은 활성화하지 않는다. 최종 검토와 발행은 사용자 동작이 필요하다.
- 브라우저 자동화 확대는 별도 정책·기술 게이트를 통과한 뒤 진행한다.

## 공통 계약

- 계약 버전: `1.0`
- 정식 API 경로: `/api/nblog/campaigns`; `/api/campaigns`는 한 릴리스 동안 호환 별칭으로 유지
- 요청 헤더: `X-NBlog-Contract-Version`, `X-Request-Id`, 변경 요청의 `Idempotency-Key`
- 응답 헤더: `X-NBlog-Contract-Version`, `X-Request-Id`
- 오류 본문: `code`, `message`, `retryable`, `resume_point`와 요청 식별자
- 스키마: `migrations/0076_nblog_operations.sql`, `migrations/0077_nblog_contract_and_handoff.sql`

## 환경 구성

스테이징과 프로덕션은 D1, R2, Workflow를 각각 별도 리소스로 만든다. Wrangler 환경의 바인딩과 변수는 상속되지 않으므로 각 환경에 모두 선언하고 실제 ID를 확인한다. 프로덕션 리소스를 스테이징에 재사용하지 않는다.

안전 스위치 `NBLOG_HANDOFF_ENABLED=false`는 신규 인계 세션 발급만 즉시 차단한다. 이미 저장된 산출물·승인·감사 로그는 보존된다.

## 보안 경계와 클라이언트 호환성

- 로컬 CLI의 `nbs_` 동기화 토큰은 캠페인 등록, 산출물 동기화, 미디어 업로드 초기화·완료의 네 가지 `POST` 경로에서만 허용한다. 조회, 승인, 재시도, 생성, 발행, 인계, 프롬프트·토큰 관리에는 사용할 수 없다.
- 브라우저 세션의 상태 변경 요청은 서비스와 동일한 `Origin`만 허용한다. 동기화, UI, 단기 인계 토큰 경로에는 서로 분리된 Cloudflare Rate Limiting 바인딩을 적용한다.
- 미디어 업로드 일회성 `nbu_` 토큰은 URL 쿼리에 포함하지 않고 `Authorization: Bearer` 헤더로만 전달한다. 로컬 CLI는 `auto-marketing-Nblog`의 `de7def6` 이상을 사용한다.
- 미디어 본문은 선언 크기와 실제 스트림 크기를 모두 검사하고, 불일치하거나 제한을 초과한 객체는 완료 처리하지 않는다.
- 동기화한 미리보기 HTML은 `sandbox` CSP와 외부 연결 차단 정책 안에서만 실행한다.
- 감사 로그와 체크포인트에는 토큰, 쿠키, 비밀번호, Authorization 값, 원문 프롬프트 또는 로컬 절대 경로를 기록하지 않는다.

## 배포 전 검증

```powershell
npm.cmd run typecheck
npm.cmd test
npx.cmd wrangler d1 migrations apply <staging-db> --env staging --remote
npx.cmd wrangler deploy --env staging
```

스테이징에서 다음 순서로 확인한다.

1. 로컬 CLI `sync --dry-run`이 네트워크와 체크포인트를 변경하지 않는지 확인한다.
2. 실제 동기화 후 D1 캠페인과 R2 산출물 체크섬·버전이 일치하는지 확인한다.
3. 검증 실패 캠페인의 승인·인계 세션 발급이 차단되는지 확인한다.
4. 승인된 버전의 일회성 claim 토큰이 한 번만 사용되는지 확인한다.
5. 만료·재사용·계약 버전 충돌 오류가 구조화된 응답을 반환하는지 확인한다.
6. 체크포인트 저장 후 재개 지점과 감사 로그가 일치하는지 확인한다.
7. 사용자가 직접 발행하기 전에는 `published`가 기록되지 않는지 확인한다.

## 프로덕션 전환

1. `main` 푸시는 스테이징까지만 자동 배포한다. 스테이징 전용 동기화 토큰은 로컬에만 두고, 실제 `403 sync_token_scope_forbidden`과 헤더 기반 미디어 업로드를 확인한다.
2. 스테이징 QA 증적과 마이그레이션 결과를 이슈 #18에 첨부한다.
3. 검증한 커밋 SHA를 `staging_verified_commit`에 넣어 `target=production` 수동 워크플로를 실행한다. 입력 SHA가 배포 커밋과 다르면 운영 배포가 중단된다.
4. D1 백업 또는 내보내기를 확보한다.
5. 프로덕션 D1에 마이그레이션을 먼저 적용한다.
6. `NBLOG_HANDOFF_ENABLED=false`로 Worker를 배포해 조회·동기화·승인 회귀를 확인한다.
7. 제한된 사용자에게만 `NBLOG_HANDOFF_ENABLED=true`를 적용하고 지표를 관찰한다.
8. 오류율, 만료율, `publish_result_unknown`, 중복 인계 시도와 감사 로그를 확인한다.

## 롤백

- 이상 발생 시 `NBLOG_HANDOFF_ENABLED=false`로 신규 세션 발급을 우선 차단한다.
- Worker 코드는 직전 안정 버전으로 되돌릴 수 있지만, 0077은 추가형 마이그레이션이므로 역방향 DDL을 실행하지 않는다.
- 기존 세션은 `cancelled`로 표시하고 토큰을 폐기한다. 산출물·승인·발행 이력은 삭제하지 않는다.
- 원인, 요청 ID, 캠페인 ID, 산출물 버전, 재개 지점을 이슈 #18에 기록한다. 인증 토큰이나 쿠키는 기록하지 않는다.

## 후속 개발 게이트

- 브라우저 도우미 배포 방식과 권한 최소화 검토
- 네이버 화면 변경 탐지와 안전한 selector 전략
- CAPTCHA·추가 인증·세션 만료 시 즉시 사용자 인계
- 사용자 최종 확인 없는 발행 금지
- 재시도 시 중복 입력·중복 발행 방지 검증
