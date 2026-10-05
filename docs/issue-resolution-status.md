# 영향도순 이슈 해결 상태

> 기준일: 2026-07-12
> 원칙: 자동 검증만으로 실제 로그인·Access·Pages 수기 완료를 주장하지 않는다.

| 우선순위 | 이슈 | 현재 상태 | 증거 | 남은 조건 |
|---:|---|---|---|---|
| 1 | [#89](https://github.com/feed-mina/planning-harness/issues/89) 일반 로그인 Garden/Pages | 코드·배포 완료 | Worker `90baca30-5927-4899-918c-72e4a5db7cc2`, Runner [29177247068](https://github.com/feed-mina/planning-harness/actions/runs/29177247068) | 실제 OAuth 로그인 후 Garden 생성→Pages URL 캡처 |
| 2 | [#88](https://github.com/feed-mina/planning-harness/issues/88) GitHub 없는 Garden | 코드·D1·배포 완료 | `0064`, Runner smoke QA, `/api/ui/garden` YAML 비노출 | Google/Kakao/email 자료 선택·직접 작성 실브라우저 캡처 |
| 3 | [#105](https://github.com/feed-mina/planning-harness/issues/105) Access 조직 보호 | 조직 연결 구현·배포 완료 | `organization_gardens`, 조직 API 401 경계, Access 설계 문서 | Cloudflare Access 정책 설정 및 허용/거부 audit log 캡처 |
| 4 | [#28](https://github.com/feed-mina/planning-harness/issues/28) AI 실제 산출물 | 결과 계약·입력 게이트 구현 | `result_contract`, 숫자/0 보존, `human_input_required` | 실제 분석자료 실행 결과·PDF/Excel·화면 캡처 |
| 5 | [#80](https://github.com/feed-mina/planning-harness/issues/80) 사람 입력 확정 게이트 | 구현·자동 검증 완료 | 서버 409 gate, 클라이언트 차단 | 브라우저 입력 확정→실행→결과 캡처 |
| 6 | [#102](https://github.com/feed-mina/planning-harness/issues/102) Provider 캐시 경계 | 구현·배포·자동 검증 완료 | `no-store`, 익명 YAML 비노출 | Provider별 로그인 전환 캡처 |
| 7 | [#103](https://github.com/feed-mina/planning-harness/issues/103) 입력 게이트 결정 | 권장안 구현 | 결정·대안 코멘트와 QA 기록 | 실제 UI 수기 캡처 |
| 8 | [#91](https://github.com/feed-mina/planning-harness/issues/91) Runner 운영 | 문서·fixture·workflow 완료 | Secret 운영 문서, run [29177247068](https://github.com/feed-mina/planning-harness/actions/runs/29177247068) | queued 빌드 실제 Pages upload 캡처 |
| 9 | [#67](https://github.com/feed-mina/planning-harness/issues/67) 구조/ERD 문서 | 문서 완료 | `docs/architecture-sdui-db-api.md`, 커밋 `571351d` | 운영 화면 캡처 첨부 |
| 10 | [#101](https://github.com/feed-mina/planning-harness/issues/101) 캐시·JWT·에이전트 기록 | 캐시 구현·정책 문서 완료 | `docs/garden-build-cache.md` | cache metrics와 설치형 agent log 후속 설계 |

## 자동 QA 완료 목록

- TypeScript·JavaScript syntax
- Wrangler dry-run
- D1 migration 적용 및 원격 metadata 확인
- Runner public/private label fixture
- 4개 `issuesDir` fixture
- 원본 링크의 invalid URL 제거
- 익명 보호 API 401 및 보호 페이지 302
- OAuth 시작 endpoint 302
- Runner Actions claim workflow 성공

## 수기 QA 공통 증거

각 이슈를 닫기 전에 [수기 QA 기록지](./garden-manual-qa-record.md)에 Provider, 실제 URL, 브라우저 캡처, Actions run URL, Access audit log를 남긴다.
