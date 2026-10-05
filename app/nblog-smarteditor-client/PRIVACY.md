# 개인정보 및 보안 안내

NBlog SmartEditor Helper는 사용자가 명시적으로 시작한 한 번의 초안 전달에
필요한 최소 데이터만 처리합니다.

## 처리하는 데이터

- 일회용 handoff session ID와 claim token
- 교환 후 짧게 유효한 handoff session token
- 사용자가 Planning Harness에서 승인한 제목, 본문, 태그
- 초안 checksum, campaign version, 진행 상태

claim token은 메모리에서 API 교환에만 사용합니다. 교환 후 세션 토큰과 초안은
브라우저가 종료되면 사라지는 `chrome.storage.session`에만 저장합니다.
입력이 끝나거나 연결이 만료되면 민감한 값과 초안 본문을 제거하고 상태
요약만 남깁니다.

## 수집하지 않는 데이터

- 네이버 ID, 비밀번호, 쿠키, OAuth token 또는 CAPTCHA 응답
- 브라우저 방문 기록, 북마크, 파일, 클립보드 전체 내용
- 광고 식별자, 분석 이벤트, 오류 원격 로그
- 이미지·동영상·장소 정보

확장 프로그램에는 네이버 사이트 전체에 대한 상시 host permission이
없습니다. 사용자가 확장 버튼을 누른 현재 탭에만 `activeTab` 권한이 생기며,
정확히 `https://blog.naver.com`인 경우에만 로컬 어댑터를 실행합니다.

네트워크 요청은 아래 두 Planning Harness origin에만 허용됩니다.

- `https://harness-meeting-app.kibayerin.workers.dev`
- `https://harness-meeting-app-staging.kibayerin.workers.dev`

원격 코드를 내려받거나 실행하지 않습니다. 포함된 북마클릿은 네트워크와
토큰을 전혀 사용하지 않으며, 초안 코드의 제목·본문·태그만 로컬 페이지에
입력합니다.

## 사용자 통제

도우미는 로그인, CAPTCHA, 미디어, 장소, 임시저장 또는 발행을 자동화하지
않습니다. SmartEditor에 입력된 결과를 사용자가 직접 검토하고 수정하며,
최종 발행 버튼도 사용자가 직접 눌러야 합니다.

브라우저 세션을 닫거나 확장 프로그램을 제거하면 세션 저장 데이터가
사라집니다. 이미 네이버 편집기에 입력된 초안은 사용자가 편집기에서 직접
삭제하거나 탭을 닫을 수 있습니다.
