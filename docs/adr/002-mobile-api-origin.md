# ADR-002: 모바일 API origin과 공통 호출 계층

- 상태: 승인 (2026-07-17, Gate 0 · 이슈 #123)
- 날짜: 2026-07-16 (승인 2026-07-17)
- 관련 이슈: #123

## 맥락

웹 클라이언트는 상대 경로 `/api/...`와 동일 출처 쿠키를 사용한다. 로컬 자산을 로드하는 모바일 WebView는 Cloudflare Worker와 출처가 다르므로 기존 호출을 그대로 사용할 수 없다.

## 결정

- 후속 PR에서 `HarnessRuntimeConfig.apiBaseUrl`과 `apiUrl()`/`apiFetch()`를 도입한다.
- 웹은 빈 base URL로 동일 출처를 유지한다.
- 모바일은 빌드 환경별 staging/production HTTPS Worker origin을 공개 설정으로 주입한다.
- Worker CORS는 실제 Capacitor origin과 메서드·헤더만 허용한다. 와일드카드 origin과 광범위한 credential 허용은 사용하지 않는다.
- timeout, 401, 오프라인, 비정상 JSON과 API 오류 형식을 공통 계층에서 정규화한다.
- 원시 `fetch("/api/...")` 재도입을 계약 테스트로 막는다.

## 결과

웹 회귀 없이 모바일 origin을 지원할 수 있다. 모든 기존 호출을 한 번에 바꾸지 않고 기능 단위로 이전하며, 어댑터로 전환되지 않은 기능은 모바일에서 지원 완료로 표시하지 않는다.
