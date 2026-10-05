# Garden·분석·Access 수기 QA 기록지

> 이 문서는 로그인된 브라우저에서 실행한 결과를 기록하는 템플릿이다. 실제 URL과 캡처가 없는 항목은 완료로 표시하지 않는다.
> 결과 이슈: [#104](https://github.com/feed-mina/planning-harness/issues/104)

## 실행 정보

- 실행일시(Asia/Seoul):
- 브라우저/기기:
- Worker version: `90baca30-5927-4899-918c-72e4a5db7cc2`
- Pages URL:
- Access application/policy:

## 1. Provider별 로그인

| Provider | 로그인 계정 | `/api/me` provider | YAML 표시 | 자료 선택 | 캡처/URL |
|---|---|---|---|---|---|
| GitHub |  | `github` | 표시 |  |  |
| Google |  | `google` | 숨김 |  |  |
| Kakao |  | `kakao` | 숨김 |  |  |
| 이메일 |  | `email` | 숨김 |  |  |

같은 브라우저에서 GitHub → Google/Kakao로 전환한 뒤 이전 YAML preview가 남지 않는지 확인한다.

## 2. Garden 생성·조직 연결

- [ ] 분석자료를 선택하고 `설정 저장`
- [ ] 회의록을 선택하고 `설정 저장`
- [ ] 직접 작성 콘텐츠만으로 `설정 저장`
- [ ] 저장 후 조직을 선택해 `조직에 연결`
- [ ] 마이페이지 조직 탭에서 연결된 Garden 표시
- [ ] Garden 소유자만 연결 해제 가능
- [ ] 조직 비멤버는 조직 Garden API에서 403

캡처/URL:

## 3. Runner·Pages

- [ ] `queued → running → succeeded`
- [ ] `site_url` 실제 접속
- [ ] `원본 자료` 링크가 분석 `?session=` 또는 회의록 `?meeting=`으로 이동
- [ ] 모바일 최근 빌드 행이 깨지지 않음
- [ ] 빌드 삭제 후 목록·R2 artifact 정리

Actions run URL:

Pages URL:

캡처:

## 4. Cloudflare Access

- [ ] 허용 조직 계정: Access 인증 후 Pages 문서 표시
- [ ] 비허용 계정: Access 거부 또는 인증 재요구
- [ ] 로그아웃 후 재접근: Access 세션 정책대로 재인증
- [ ] Access audit log에 허용/거부 기록
- [ ] HTML·manifest에 JWT/OAuth/Runner secret 없음

Access audit log URL/캡처:

## 5. 분석 결과·입력 게이트

- [ ] 수문 자료: 인원·시간·단가·총액·수식·근거
- [ ] 원가 자료: 숫자 결과와 0 값 보존
- [ ] 비교 자료: 비교표·차이값·해석
- [ ] 정책 자료: 보고서·결론·다음 조치
- [ ] 미확정 담당자 입력: 실행 차단 및 입력 패널 표시
- [ ] 확정 후 실행·PDF·Excel·마이페이지 저장 반영

캡처/URL:

## 판정

- 자동 QA: 통과
- 수기 QA: `통과 / 조건부 / 실패 / 미실행`
- 미실행 사유:
- 다음 조치:
