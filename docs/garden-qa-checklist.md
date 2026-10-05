# Garden·분석 QA 체크리스트

이 문서는 Garden·분석 기능을 배포할 때 반복해서 확인할 자동 QA와 로그인 사용자 수기 QA를 한 곳에 모은다.

## 1. 자동 QA

```powershell
cd app
npm.cmd run typecheck
npm.cmd run qa:garden-runner
node --check public/assets/analysis-edit2.js
node --check public/assets/sdui-garden.js
node --check public/assets/sdui-engine.js
npm.cmd run deploy -- --dry-run
```

원격 상태:

```powershell
npx.cmd wrangler d1 migrations list harness-meeting-db --remote
Invoke-WebRequest https://harness-meeting-app.kibayerin.workers.dev/api/health
Invoke-WebRequest https://harness-meeting-app.kibayerin.workers.dev/api/ui/garden
```

Runner fixture:

```powershell
node templates/garden-runner/build-garden.mjs `
  --config templates/garden-runner/fixtures/garden.config.yaml `
  --issues templates/garden-runner/fixtures/issues.json `
  --out tmp/garden-qa
```

확인 기준:

- `/api/health`는 200이어야 한다.
- API JSON은 `Cache-Control: no-store`여야 한다.
- 익명 `/api/ui/garden`에는 YAML preview가 없어야 한다.
- 익명 Garden/분석 관리 API는 401이어야 한다.
- Runner 결과의 `counts.included`와 `counts.excluded`가 label 정책과 일치해야 한다.
- `source.issuesDir`가 `Knowledge/Issues`, `Issues`, `docs/issues`, `content/issues` 중 설정값과 일치해야 한다.
- `example.invalid` 또는 비HTTP 원본 링크가 산출물에 없어야 한다.

## 2. 로그인 수기 QA

### Provider별 UI

- [ ] GitHub 로그인: repo·공개 label·Issues 경로·YAML preview 표시
- [ ] Google 로그인: YAML preview 숨김, 분석자료·회의록·직접 작성 표시
- [ ] Kakao 로그인: YAML preview 숨김, 분석자료·회의록·직접 작성 표시
- [ ] 이메일 로그인: YAML preview 숨김, 분석자료·회의록·직접 작성 표시
- [ ] 같은 브라우저에서 GitHub → Google/Kakao 전환 후 이전 YAML 응답이 남지 않음

### Garden 생성·배포

- [ ] 본인 분석자료를 선택해 저장
- [ ] 본인 회의록을 선택해 저장
- [ ] 직접 작성 콘텐츠만으로 저장
- [ ] `설정 저장`과 `빌드 요청`의 툴팁 설명 확인
- [ ] `queued → running → succeeded` 상태 전이 확인
- [ ] 완료 후 `사이트 열기`가 실제 Pages URL을 열어 줌
- [ ] 정적 페이지의 `원본 자료`가 `/analysis-edit2/?session=...` 또는 `?meeting=...`으로 열림
- [ ] 다른 사용자 source ID 입력이 403/404로 거부됨
- [ ] 모바일 최근 빌드 행의 상태·날짜·버튼이 세로로 깨지지 않음
- [ ] Garden/빌드 삭제 후 목록과 R2 산출물이 정리됨

### 분석 결과·입력 게이트

- [ ] 수문 자료: 인원·시간·단가·총액·수식·근거 표시
- [ ] 원가 자료: 결과값과 수식, 0 값 포함
- [ ] 비교 자료: 비교표·차이값·해석 표시
- [ ] 정책 자료: 보고서 문단·표·결론·다음 조치 표시
- [ ] 브라우저 계정 전환: AI가 실제 조작을 완료했다고 쓰지 않고 체크리스트 표시
- [ ] 미확정 담당자 입력에서 실행이 차단되고 입력 패널이 열림
- [ ] 값을 확정한 뒤 실행·PDF·Excel·마이페이지 저장 결과에 반영됨

### 운영·보안

- [ ] 로그아웃/JWT 만료 후 보호 API가 401
- [ ] Cloudflare Access 허용 조직만 Pages 접근 가능
- [ ] Garden 삭제 후 72시간 cleanup job 예약
- [ ] cleanup 실패 시 retry와 운영 오류가 기록됨
- [ ] Runner token·JWT·OAuth secret가 화면·manifest·로그에 노출되지 않음

### 조직 Garden·Cloudflare Access

- [ ] Garden 소유자가 조직을 선택해 연결할 수 있음
- [ ] 조직 멤버가 마이페이지 조직 탭에서 연결된 Garden과 URL을 볼 수 있음
- [ ] 조직 비멤버가 `GET /api/orgs/:orgId/gardens`에서 403을 받음
- [ ] Garden 소유자 또는 조직 관리자만 연결을 해제할 수 있음
- [ ] Pages Access 허용 계정만 실제 문서를 열 수 있음
- [ ] Pages 비허용 계정·로그아웃 상태는 Access 로그인/거부 화면으로 이동함
- [ ] Access audit log와 마이페이지 캡처를 함께 보관함

## 3. 증거 보관

QA 결과와 수기 캡처는 [GitHub QA 이슈 #104](https://github.com/feed-mina/planning-harness/issues/104)에 커밋·배포 버전과 함께 기록한다. 각 완료 이슈에는 해당 페이지 캡처와 실제 URL을 첨부하고, 로그인 세션이 없는 경우 완료로 닫지 않는다.
