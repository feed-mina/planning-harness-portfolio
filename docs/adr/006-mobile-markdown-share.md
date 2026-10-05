# ADR-006: 모바일 Markdown OS 공유

- 상태: 구현 (2026-07-19, 이슈 #123 독립 슬라이스)
- 날짜: 2026-07-19
- 관련 이슈: #123

## 맥락

웹의 회의록 내보내기는 브라우저 Blob 다운로드만 사용한다. Capacitor WebView에서는 다운로드 동작이 플랫폼마다 다르고, 사용자는 메일·메신저·파일 앱 등 OS 공유 대상을 선택해야 한다. 회의록 원문은 민감할 수 있으므로 공유용 파일을 영구 저장하거나 Android 전체 저장소를 `FileProvider`로 공개하면 안 된다.

## 결정

- 웹에서는 기존 UTF-8 BOM 포함 `.md` 다운로드를 유지한다.
- 네이티브에서는 `@capacitor/filesystem`으로 `Directory.Cache/shared-markdown/<일회용 ID>/`에 UTF-8 파일을 만든다.
- `@capacitor/share`의 `files`에 생성된 `file://` URI만 전달하고, 완료·취소·오류 모두 `finally`에서 파일과 일회용 폴더를 삭제한다.
- 앱 시작과 각 공유 직전에 `shared-markdown/` 루트를 재귀 삭제한다. 네이티브 공유 작업을 직렬화해 강제 종료로 남은 파일을 다음 실행에서 제거하면서 진행 중인 공유와 충돌하지 않게 한다.
- Android `FileProvider`는 `shared-markdown/` 캐시 하위 경로만 공개한다. 외부 저장소와 캐시 루트 전체는 공개하지 않는다.
- 파일명은 경로 구분자, 제어 문자, bidi 제어 문자, Windows 예약 이름을 제거하고 80자로 제한한다.
- 공유 취소는 사용자 오류로 표시하지 않되, 임시 파일 정리 실패는 명시적 오류로 처리한다.
- iOS 앱 타깃에는 Filesystem 플러그인이 요구하는 `NSPrivacyAccessedAPICategoryFileTimestamp` / `C617.1` privacy manifest를 포함한다.

## 검증 경계

mock 계약 테스트가 시작 시 잔여 루트 정리, 정리 실패 후 재시도, 파일 생성 → 공유 → 정리 순서, 취소 정리, 웹 fallback, Android 노출 범위와 iOS manifest 번들을 검증한다. 실제 공유 대상 앱이 파일을 열 수 있는지와 공유 UI 취소 동작은 Android/iOS 실기기에서 별도로 확인한다.
