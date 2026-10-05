# docs/ — 웹 회의록 메이커 (GitHub Pages)

`녹음·자막 파일로 회의록 만들기` 정적 웹앱. 전사 → 요약·결정·할 일 Markdown 회의록을 만들어
기획 하네스 파이프라인(`meetings/summary/` → `/git-project-sync`)으로 연결한다.

- **URL**: https://feed-mina.github.io/planning-harness/
- **배포**: `main` 에 `docs/**` 가 푸시되면 [.github/workflows/pages.yml](../.github/workflows/pages.yml) 이 Pages 로 배포.
  - 최초 1회: repo **Settings → Pages → Source = "GitHub Actions"** 설정 필요.

## 입력 방식 (전부 브라우저에서, 서버 없음)
1. **자막 파일** `.vtt` / `.srt` / `.txt` — 타임코드·화자태그·중복 제거 후 전사로 로드 (100% 로컬).
2. **실시간 녹음** — 브라우저 Web Speech API (Chrome/Edge, `ko-KR`).
3. **오디오 파일 → Clova/외부 STT** — 사용자가 Invoke URL + Secret 키를 입력한 경우. *브라우저 CORS 로 막히면 프록시 필요.*

## 회의록 생성
- **규칙기반 초안** — 키 없이 동작. 결정/할 일 후보를 휴리스틱 추출(검토 필요).
- **AI 요약 (Claude)** — 사용자의 Anthropic API 키로 브라우저에서 직접 호출
  (`anthropic-dangerous-direct-browser-access`). 고품질 요약 + 정확한 할 일 포맷.

## 보안
- 키는 **브라우저 localStorage 에만** 저장, 커밋/서버 전송 없음. 공용 PC 사용 후 "키 지우기".
- 자막·오디오 원문도 브라우저 밖으로 나가지 않음(Clova/Claude 호출 시에만 해당 API 로 직접 전송).

## 하네스 연결
내려받는 파일명은 `YYYY-MM-DD_meeting.md`, 내용은 `templates/meeting_template.md` 와 동일 포맷
(`## 할 일` + `- [ ] … — @담당자 ~날짜 [priority:…]`). 그대로 `meetings/summary/` 에 넣으면
`/git-project-sync <날짜>` 가 파싱 → dry-run → 승인 → GitHub Issues/Project.

## 파일
- `index.html` · `styles.css` · `app.js` — 빌드 없음(정적·확실).
