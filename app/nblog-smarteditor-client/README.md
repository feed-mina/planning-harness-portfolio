# NBlog SmartEditor Helper (Phase A)

Planning Harness에서 승인한 NBlog 초안을 사용자가 열어 둔 네이버 블로그
SmartEditor의 빈 글에 옮기는 Chrome Manifest V3 확장 프로그램입니다.

이 도우미는 제목, 본문, 태그만 입력합니다. 네이버 로그인, CAPTCHA 처리,
이미지·동영상 업로드, 장소 삽입, 임시저장 또는 발행 버튼 클릭은 자동화하지
않습니다. 최종 검토와 발행은 항상 사용자가 직접 해야 합니다.

## 설치

1. Chrome에서 `chrome://extensions`를 엽니다.
2. **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. 이 `nblog-smarteditor-client` 폴더를 선택합니다.

확장 프로그램은 다음 권한만 사용합니다.

- `activeTab`: 사용자가 확장 버튼을 누른 현재 네이버 블로그 탭
- `scripting`: 로컬 SmartEditor 어댑터를 해당 탭의 프레임에 주입
- `storage`: 짧게 유효한 연결 상태를 브라우저 세션 동안만 보관
- 정확히 지정된 운영/스테이징 Planning Harness 호스트와의 통신

## 사용 흐름

1. Planning Harness의 NBlog 화면에서 10분 동안 유효한 연결 코드를 만듭니다.
2. 같은 Chrome에서 네이버 블로그에 로그인하고 **새 글 쓰기**를 엽니다.
3. 제목과 본문이 비어 있는지 확인합니다.
4. 확장 프로그램 팝업을 열어 `NBLOG_HANDOFF_V1.` 연결 코드를 붙여넣습니다.
5. 도우미가 일회용 코드를 교환하고 제목·본문·태그를 빈 편집기에 입력합니다.
6. 사진·동영상·장소와 문장을 직접 확인한 뒤 사용자가 직접 발행합니다.

연결 코드는 아래 JSON을 base64url로 인코딩한 값입니다. 필드가 추가되거나
호스트·경로·계약 버전이 다르면 안전하게 거절합니다.

```text
NBLOG_HANDOFF_V1.<base64url(JSON)>
```

```json
{
  "version": 1,
  "api_origin": "https://harness-meeting-app.kibayerin.workers.dev",
  "session_id": "UUID-v4",
  "claim_path": "/api/nblog/handoff-sessions/<session_id>/claim",
  "claim_token": "nbh_...",
  "contract_version": "1.1",
  "expires_at": "ISO-8601"
}
```

일회용 claim token은 URL, DOM, `localStorage` 또는 영구 확장 저장소에 넣지
않습니다. 교환 후 받은 세션 토큰과 초안도 `chrome.storage.session`에만
잠시 보관하며 성공·만료 시 제거합니다.

## 오프라인 북마클릿

`public/nblog-handoff/bookmarklet.js`는 네트워크를 전혀 사용하지 않는 대체
도구입니다. `NBLOG_DRAFT_V1.` 코드는 아래 일곱 필드만 포함할 수 있습니다.

```json
{
  "version": 1,
  "title": "초안 제목",
  "body": "초안 본문",
  "tags": ["태그1", "태그2"],
  "place_name": "직접 선택할 장소",
  "target_blog": "https://blog.naver.com/example",
  "category": "직접 선택할 카테고리"
}
```

초안 코드에는 글 내용 자체가 들어 있으므로 비밀 채널 밖으로 공유하지
마세요. 북마클릿에는 Harness 토큰 또는 API 주소를 넣을 수 없으며, Naver
페이지에서 네트워크 요청도 하지 않습니다. 장소·대상 블로그·카테고리는
안내용으로만 보존하고 자동 선택하지 않습니다.

## 안전 동작

- 빈 편집기에만 입력하며 기존 글을 덮어쓰지 않습니다.
- 초안에 대상 블로그가 지정된 경우 현재 글쓰기 URL의 blogId가 일치해야 입력합니다.
- 같은 내용이면 다시 입력하지 않고 `already_applied`로 끝냅니다.
- 제목/본문 후보가 없거나 둘 이상이면 DOM 변경으로 판단하고 중단합니다.
- 버튼을 클릭하지 않으며 로그인·CAPTCHA·미디어·장소·발행을 건드리지 않습니다.
- 원격 스크립트, 분석 도구, 광고 SDK 또는 사용자 활동 기록이 없습니다.

SmartEditor DOM은 네이버가 변경할 수 있습니다. selector 불일치가 발생하면
새 selector를 추측하여 계속 진행하지 말고 어댑터와 테스트를 검토해야 합니다.

## 개발 검증

`app` 폴더에서 실행합니다.

```powershell
node --test tests/nblog-browser-helper.test.cjs
```

수동 검증은 테스트용 비공개 초안으로 수행합니다.

- 운영/스테이징 연결 코드 각각 1회
- 로그인 전, CAPTCHA 표시, 이미 내용이 있는 글에서 안전 중단
- 제목/본문/태그 입력 후 미디어·장소·발행이 수동 상태인지 확인
- 같은 연결/초안 재시도 시 중복 입력이 없는지 확인
