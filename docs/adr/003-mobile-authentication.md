# ADR-003: 모바일 OAuth와 세션

- 상태: 승인 (2026-07-17, Gate 0 · 이슈 #123)
- 날짜: 2026-07-16 (승인 2026-07-17)
- 관련 이슈: #123

## 맥락

현재 `sid` HttpOnly 쿠키 세션은 웹 동일 출처를 전제로 한다. AI 프록시 키는 권한과 수명이 다른 자격증명이므로 모바일 사용자 세션으로 재사용할 수 없다.

## 결정

- 앱은 시스템 브라우저로 기존 OAuth 시작 경로를 연다.
- 서버가 provider callback과 state 검증을 끝낸 뒤 1~2분 수명의 일회용 교환 코드를 발급한다.
- Universal Link/App Link로 앱에 복귀하고 PKCE verifier와 코드를 교환한다.
- 서버는 짧은 access token과 회전 가능한 refresh token을 발급한다.
- refresh token 원문은 서버에 저장하지 않고 해시만 저장하며, 앱 원문은 OS secure storage에 보관한다.
- 코드 일회성, refresh rotation·재사용 탐지, revoke, rate limit과 로그 redaction을 필수로 한다.
- 기존 웹 쿠키 인증은 유지하고 Bearer 식별을 추가한다.
- Sign in with Apple 적용 여부는 iOS 트랙 착수 시점에 Apple 심사 4.8 요건을 확인한 뒤 결정한다. Android 우선 진행 동안은 GitHub·Google·Kakao provider만 대상으로 한다. (Gate 0 결정, 이슈 #123)

## 결과

모바일과 웹 세션을 독립적으로 폐기할 수 있고 앱 번들에 장기 secret이 들어가지 않는다. 딥링크 도메인, 앱 ID, provider별 callback 등록이 확정되기 전에는 인증 구현을 production에서 활성화하지 않는다.

## 구현 운영 게이트 (2026-07-19)

- `MOBILE_AUTH_ENABLED`의 기본값은 `false`다. 운영자가 필요한 설정과 후속 앱 연동을 검증한 환경에서만 `true`로 전환한다.
- `MOBILE_AUTH_REDIRECT_URIS`는 JSON 문자열 배열이며, 요청의 `redirect_uri`와 문자열이 정확히 일치해야 한다. 빈 배열이나 잘못된 설정에서는 코드 발급·교환을 허용하지 않는다.
- authorization code 유효시간은 120초다. 코드 발급·교환, refresh, revoke에는 D1의 원자적 고정 윈도 카운터를 적용하며 IP와 사용자 또는 token family 식별자는 SHA-256 해시로만 저장한다.
- 이번 구현 범위는 PKCE code, opaque access/refresh token, rotation/reuse revoke, rate limit을 제공하는 backend primitive다. 기존 OAuth callback에서 앱으로 복귀하는 bridge와 OS Secure Storage 저장·복원은 후속 구현 및 실제 기기 검증 범위다.
