# SDUI·D1·API 전체 구조

> Garden 구현 갱신(2026-07-12): 분석 발행은 `planning-harness.garden-content.v2`의 kind별 `sections`를 사용한다. `publish.sections` 미설정은 전체 공개이며, 빌드는 `garden-content-v2.1` fingerprint로 합쳐진다. 사용자별 조회 캐시는 Garden 10초·종료 빌드 3초이고 `queued/running`은 캐시하지 않는다. 조직-Garden 연결은 `organization_gardens`와 migration 0065로 관리하며, 실제 Pages 문서 보호는 Cloudflare Access가 담당한다.

이 문서는 현재 저장소의 실제 코드를 기준으로 Cloudflare 인프라, SDUI 렌더링, D1 데이터 모델, API 라우팅, 분석·회의록·Garden 실행 흐름을 설명한다.

기준 파일:

- **app/wrangler.jsonc**
- **app/src/index.ts**
- **app/src/sdui.ts**
- **app/public/assets/sdui-engine.js**
- **app/public/assets/sdui-*.js**
- **app/src/analysis.ts**, **app/src/gardens.ts**, **app/src/usage.ts**
- **app/migrations/*.sql**
- **templates/garden-runner/build-garden.mjs**

> 이 문서에는 secret 값, OAuth 값, 토큰, 운영 식별자를 기록하지 않는다.

## 1. 전체 인프라 구조

SDUI를 포함한 전체 요청은 다음처럼 흐른다.

~~~mermaid
flowchart LR
    U[브라우저] -->|HTML CSS JS| A[Cloudflare Static Assets<br/>app/public]
    U -->|/api/*| W[Cloudflare Worker<br/>app/src/index.ts]
    W --> D[(D1<br/>계정·상태·메타데이터)]
    W --> R[(R2<br/>회의록·파일·첨부·Garden artifact)]
    W --> V[(Vectorize<br/>RAG 검색 인덱스)]
    W --> AI[Claude / OpenAI / Gemini]
    W --> O[GitHub / Google / Kakao OAuth]
    W --> STT[Clova Speech]
    W --> MAIL[메일 발송]
    W --> TRACE[DagsHub 추적]
    RUN[Garden Runner] -->|Bearer token| W
    RUN --> P[Cloudflare Pages]
~~~

1. 정적 화면은 Static Assets가 제공한다.
2. /api/*, 로그인 보호 페이지, 분석·Garden 페이지는 Worker가 먼저 처리한다.
3. Worker는 D1을 계정·권한·상태·메타데이터 저장소로 사용한다.
4. 큰 원본 파일은 R2에, 검색용 벡터는 Vectorize에 저장한다.
5. AI·OAuth·STT·메일·추적 시스템은 Worker가 중계한다.
6. Garden Runner는 queued 작업을 받아 결과를 Pages와 R2에 남긴다.

## 2. SDUI 구조

SDUI는 HTML을 서버가 통째로 내려주는 방식이 아니다. D1의 ui_metadata 설계도를 서버가 JSON 트리로 만들고, 브라우저 엔진이 실제 DOM으로 조립한다.

- ui_metadata: 화면 설계도
- GET /api/ui/:pageKey: 설계도를 JSON 트리로 반환하는 API
- sdui-engine.js: 공통 DOM 조립기
- sdui-*.js: 페이지별 업무 로직·API 연결 플러그인

### 2.1 렌더링 순서

~~~mermaid
sequenceDiagram
    actor User as 사용자
    participant Page as 정적 페이지 #root
    participant Engine as sdui-engine.js
    participant Worker as Worker
    participant Meta as D1 ui_metadata
    participant Plugin as 페이지 플러그인
    participant API as 도메인 API

    User->>Page: /garden/·/content/·/time-settings/ 진입
    Page->>Engine: 엔진 boot
    Engine->>Worker: GET /api/ui/:pageKey
    Worker->>Worker: sid/aid 식별 및 provider 판정
    Worker->>Meta: page_key별 flat row 조회
    Worker->>Worker: allowed_roles/provider 필터
    Worker->>Worker: parent_node_id + order_index로 buildTree
    Worker-->>Engine: UiPageResult JSON
    Engine->>Engine: componentMap 재귀 렌더링
    Engine->>Plugin: init(ctx)
    Plugin->>API: 목록·상세·상태 API 호출
    API-->>Plugin: JSON
    Plugin-->>User: 위젯·버튼·상태 표시
~~~

1. 페이지 HTML은 빈 root 영역과 엔진/플러그인 JavaScript로 시작한다.
2. 엔진이 /api/ui/:pageKey를 호출한다.
3. Worker가 로그인 사용자와 provider를 판별한다.
4. D1에서 해당 페이지의 flat row를 읽는다.
5. allowed_roles와 provider 조건에 맞지 않는 노드를 제거한다.
6. buildTree가 parent_node_id와 order_index를 이용해 계층 트리를 만든다.
7. 브라우저 componentMap이 GROUP, TEXT, INPUT, SELECT, BUTTON, WIDGET을 DOM으로 만든다.
8. 페이지 플러그인의 init, hydrator, widget이 실제 데이터 API를 호출한다.
9. 버튼은 action_type을 통해 플러그인 액션으로 연결된다.
10. 화면 골격은 D1로 바꿀 수 있지만 업무 로직은 플러그인과 API가 담당한다.

### 2.2 ui_metadata 컬럼

| 컬럼 | 역할 |
|---|---|
| page_key | garden, content, time-settings 같은 페이지 식별자 |
| node_id | 페이지 안의 노드 고유 이름 |
| component_type | GROUP, TEXT, INPUT, SELECT, BUTTON, WIDGET 등 |
| props_json | DOM id, class, text, options, hidden 등의 표시 속성 |
| parent_node_id | 부모 노드. 트리 연결선 |
| group_direction | 자식 정렬 방향 ROW 또는 COLUMN |
| order_index | 같은 부모 안의 표시 순서 |
| action_type | 버튼 클릭 시 실행할 명령 이름 |
| ref_data_id | hydrator/widget 데이터 연결 키 |
| allowed_roles | public, logged_in, provider:github 등의 노출 조건 |

### 2.3 SDUI 파일 역할

1. **app/src/sdui.ts**: D1 row 조회, role/provider 필터, 트리 생성
2. **app/public/assets/sdui-engine.js**: 공통 DOM 렌더러, action/hydrator/widget 실행
3. **app/public/assets/sdui-garden.js**: Garden 폼, 자료·로고·빌드·YAML 플러그인
4. **app/public/assets/sdui-content.js**: 콘텐츠 목록·편집·첨부 플러그인
5. **app/public/assets/sdui-time-settings.js**: 시간 설정·블록 플러그인
6. **app/public/assets/sdui-legacy.js**: 레거시 호환 플러그인
7. **app/migrations/0013_ui_metadata.sql**: SDUI 기본 테이블과 초기 seed
8. **0024~0029, 0030, 0031~0043, 0053~0065**: 페이지별 UI와 Garden/분석/로그인 게이트, 공개 section 선택, 빌드 fingerprint·조직 연결 확장

### 2.4 Garden YAML 노출 규칙

1. GitHub 로그인 사용자는 YAML 미리보기를 받을 수 있다.
2. Google·Kakao·email 로그인 사용자는 서버 단계에서 garden.preview subtree가 제거된다.
3. GitHub repo 목록처럼 GitHub OAuth token이 필요한 기능은 provider와 token을 모두 검사한다.
4. 따라서 로그인 가능 여부와 GitHub 기능 사용 가능 여부는 별도 권한이다.

## 3. D1 데이터베이스 구조

현재 마이그레이션 기준으로 D1에는 40개 테이블이 있다.

### 3.1 도메인별 테이블

| 도메인 | 테이블 |
|---|---|
| 계정·인증 | users, user_identities, email_credentials, user_devices |
| 설정·사용량 | settings, usage_events, usage_limits, usage_alerts |
| 조직·감사 | organizations, organization_members, organization_invites, organization_audit_logs, organization_gardens |
| 회의·분석 | meetings, clova_recordings, history_marks, analysis_sessions, analysis_files, analysis_chunks, analysis_outputs |
| AI 평가 | ai_eval_cases, ai_eval_runs |
| 시간·콘텐츠 | user_time_settings, user_time_blocks, content_posts, content_assets |
| 외부 연동 | integration_tokens, external_calendar_events, notification_jobs |
| 프록시 | proxy_keys, device_registration_codes |
| Kanban·스케줄 | kanban_boards, kanban_cards, schedule_feedback_entries, schedule_feedback_assets |
| Garden·UI | gardens, garden_builds, garden_assets, garden_site_cleanup_jobs, organization_gardens, ui_metadata |

### 3.2 읽기 쉬운 분할 ERD

전체 테이블을 한 장에 넣으면 Mermaid가 가로로 축소되어 읽기 어렵다. 아래처럼 업무 영역을 네 장으로 나눠야 각 관계와 방향을 확인하기 쉽다.

#### 3.2.1 계정·인증·사용량

~~~mermaid
erDiagram
    USERS ||--o{ USER_IDENTITIES : has
    USERS ||--o| SETTINGS : owns
    USERS ||--o{ USAGE_EVENTS : generates
    USERS ||--o| USAGE_LIMITS : configures
    USERS ||--o{ USAGE_ALERTS : receives
    USERS ||--o{ USER_DEVICES : links
~~~

1. USERS는 모든 사용자 소유 데이터의 기준 계정이다.
2. USER_IDENTITIES는 provider별 외부 로그인 정보를 연결한다.
3. USAGE_EVENTS는 앱·proxy·import 호출의 토큰·비용 이벤트다.
4. USER_DEVICES는 익명 기기와 로그인 계정을 연결한다.

#### 3.2.2 회의록·분석·AI 평가

~~~mermaid
erDiagram
    USERS ||--o{ MEETINGS : owns
    USERS ||--o{ CLOVA_RECORDINGS : imports
    USERS ||--o{ ANALYSIS_SESSIONS : owns
    ANALYSIS_SESSIONS ||--o{ ANALYSIS_FILES : contains
    ANALYSIS_SESSIONS ||--o{ ANALYSIS_OUTPUTS : produces
    ANALYSIS_FILES ||--o{ ANALYSIS_CHUNKS : splits
    USERS ||--o{ AI_EVAL_CASES : defines
    AI_EVAL_CASES ||--o{ AI_EVAL_RUNS : runs
    USERS ||--o{ HISTORY_MARKS : marks
~~~

1. MEETINGS는 회의록 메타데이터이며 본문은 R2에 저장된다.
2. ANALYSIS_SESSIONS가 하나의 분석 작업 단위다.
3. ANALYSIS_FILES는 세션에 속한 업로드 파일 메타데이터다.
4. ANALYSIS_CHUNKS는 RAG 검색용 텍스트 조각과 Vectorize ID를 가진다.
5. ANALYSIS_OUTPUTS는 요약·아이디어·계획·manual 결과 JSON이다.
6. AI_EVAL_CASES와 AI_EVAL_RUNS는 결과 품질과 비용을 평가한다.

#### 3.2.3 조직·프록시·시간·콘텐츠

~~~mermaid
erDiagram
    USERS ||--o{ ORGANIZATIONS : owns
    ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERS : has
    ORGANIZATIONS ||--o{ ORGANIZATION_INVITES : sends
    ORGANIZATIONS ||--o{ ORGANIZATION_AUDIT_LOGS : records
    ORGANIZATIONS ||--o{ ORGANIZATION_GARDENS : shares
    GARDENS ||--o{ ORGANIZATION_GARDENS : linked
    USERS ||--o{ PROXY_KEYS : issues
    USER_DEVICES ||--o{ PROXY_KEYS : uses
    USERS ||--o{ DEVICE_REGISTRATION_CODES : creates
    USERS ||--o| USER_TIME_SETTINGS : configures
    USERS ||--o{ USER_TIME_BLOCKS : schedules
    USERS ||--o{ CONTENT_POSTS : writes
    CONTENT_POSTS ||--o{ CONTENT_ASSETS : attaches
    USERS ||--o{ KANBAN_BOARDS : owns
    KANBAN_BOARDS ||--o{ KANBAN_CARDS : contains
~~~

1. ORGANIZATIONS가 조직 단위이고 MEMBERS가 역할·상태를 가진다.
2. INVITES와 AUDIT_LOGS는 조직 운영 기록이다.
3. PROXY_KEYS는 외부 AI 클라이언트가 사용할 수 있는 사용자/기기별 키다.
4. USER_TIME_SETTINGS·USER_TIME_BLOCKS는 개인 시간 설정과 날짜별 블록이다.
5. CONTENT_POSTS는 글, CONTENT_ASSETS는 R2 첨부 메타데이터다.
6. KANBAN_BOARDS와 KANBAN_CARDS는 회의 action item을 관리한다.

#### 3.2.4 Garden·UI 메타데이터

~~~mermaid
erDiagram
    USERS ||--o{ GARDENS : configures
    GARDENS ||--o{ GARDEN_BUILDS : queues
    GARDENS ||--o{ GARDEN_ASSETS : stores
    GARDENS ||--o{ ORGANIZATION_GARDENS : shared_with
    GARDENS ||--o{ GARDEN_SITE_CLEANUP_JOBS : cleans
    UI_METADATA ||--o{ UI_METADATA : parent_child
~~~

1. GARDENS는 repository별 사이트 설정과 현재 상태다.
2. GARDEN_BUILDS는 draft와 분리된 queued/running/succeeded/failed 실행 이력이다.
3. GARDEN_ASSETS는 로고 같은 업로드 파일의 R2 메타데이터다.
4. GARDEN_SITE_CLEANUP_JOBS는 만료된 Pages 정리 예약이다.
5. UI_METADATA는 업무 데이터가 아닌 화면 설계도이며 parent_node_id로 자기 자신을 트리처럼 연결한다.

> 모든 논리 관계가 SQLite FOREIGN KEY로 선언된 것은 아니다. 일부 user_id, session_id, org_id 관계는 애플리케이션 쿼리와 권한 검사로 보장된다.

### 3.3 저장소 역할 분리

~~~mermaid
flowchart TB
    D1[(D1)] --> D1A[계정·설정·상태·메타데이터·JSON 결과]
    R2[(R2)] --> R2A[회의록 Markdown]
    R2 --> R2B[분석 업로드 파일]
    R2 --> R2C[콘텐츠 첨부]
    R2 --> R2D[Garden config·manifest·package·artifact]
    V[(Vectorize)] --> VA[분석 chunk embedding]
    AS[Static Assets] --> ASA[HTML·CSS·JS·이미지]
~~~

## 4. API 전체 지도

모든 API 진입점은 **app/src/index.ts**이고, 실제 도메인 로직은 auth.ts, analysis.ts, gardens.ts, usage.ts, content.ts 등으로 위임된다.

### 4.1 인증·세션

1. GET /api/auth/github, /api/auth/callback
2. GET /api/auth/google, /api/auth/google/callback
3. GET /api/auth/kakao, /api/auth/kakao/callback
4. POST /api/auth/email/register, /login, /verify
5. POST /api/auth/email/resend-verification
6. POST /api/auth/email/reset/request, /confirm
7. GET /api/auth/logout
8. GET /api/me

### 4.2 SDUI·공통·개발 환경

1. GET /api/health
2. GET /api/ui/:pageKey
3. GET /api/dev-setup/catalog
4. POST /api/dev-setup/preview
5. POST /api/dev-setup/script

### 4.3 Garden·Runner

1. GET/POST /api/gardens
2. GET/PUT/PATCH/DELETE /api/gardens/:gardenId
3. GET/POST/DELETE /api/gardens/:gardenId/logo
4. GET /api/gardens/:gardenId/config.yaml
5. GET /api/gardens/:gardenId/builds
6. POST /api/gardens/:gardenId/build
7. DELETE /api/gardens/:gardenId/builds/:buildId
8. GET /api/gardens/:gardenId/builds/:buildId/artifact
9. GET /api/gardens/:gardenId/organizations
10. POST /api/gardens/:gardenId/organizations
11. DELETE /api/gardens/:gardenId/organizations/:orgId
12. POST /api/garden-runner/builds/next
13. GET /api/garden-runner/gardens/:gardenId/builds/:buildId/artifact
14. POST /api/gardens/:gardenId/builds/:buildId/callback

### 4.4 분석·AI·회의록·히스토리

1. POST /api/ai/summarize
2. GET /api/ai/evals
3. POST /api/ai/evals/cases, /runs
4. GET /api/ai/evals/report
5. GET/POST /api/analysis/sessions
6. GET/PUT/PATCH/DELETE /api/analysis/sessions/:sessionId
7. POST /api/analysis/sessions/:id/files
8. DELETE /api/analysis/sessions/:id/files/:fileId
9. POST /api/analysis/sessions/:id/summaries, /ideas, /plans, /manual
10. POST /api/analysis/sessions/:id/plan-runs, /executions
11. GET /api/meetings, /api/meetings/:meetingId
12. POST /api/meetings/from-recording
13. GET /api/history, GET/PATCH /api/history/:kind/:id
14. GET/PUT /api/settings

### 4.5 사용량·조직·프록시

1. GET /api/usage, /series, /breakdown, /cost-dashboard
2. POST /api/usage/reset
3. GET /api/usage/subjects, /requests, /export, /alerts
4. GET/PUT /api/usage/limits
5. GET/POST /api/orgs
6. GET /api/orgs/:orgId
7. POST /api/orgs/:orgId/invites
8. PATCH/DELETE /api/orgs/:orgId/members/:userId
9. GET /api/orgs/:orgId/usage, /usage/export
10. GET/PUT /api/orgs/:orgId/settings
11. GET /api/orgs/:orgId/audit-logs
12. GET /api/orgs/:orgId/gardens
13. POST /api/org-invites/:inviteId/accept
13. /api/proxy/devices, /api/proxy/device-codes 계열
14. /api/proxy/anthropic/*, /api/proxy/openai/*, /api/proxy/gemini/*

### 4.6 시간·콘텐츠·연동·Git

1. GET/PUT /api/time-settings
2. GET/POST /api/time-blocks, DELETE /api/time-blocks/:id
3. GET/POST /api/content/posts
4. GET/PATCH/DELETE /api/content/posts/:postId
5. GET/POST /api/content/posts/:postId/assets
6. GET/DELETE /api/content/posts/:postId/assets/:assetId
7. /api/kanban/boards, /api/kanban/cards, /api/kanban/cards/from-meeting
8. POST /api/stt/clova
9. /api/me/clova/recordings 계열
10. Google Calendar·Kakao 메시지 integration 경로
11. /api/git/defaults, /repos, /assignees, /projects, /issues
12. /api/schedule/cards, /assets, /feedback

## 5. 핵심 업무 흐름

### 5.1 분석·RAG·AI

~~~mermaid
flowchart LR
    S[analysis_sessions] --> F[analysis_files]
    F --> R2[(R2 원본)]
    F --> C[analysis_chunks]
    C --> V[(Vectorize)]
    V --> Q[근거 검색]
    Q --> AI[AI provider]
    AI --> O[analysis_outputs]
    AI --> U[usage_events]
    O --> UI[분석 결과 UI]
~~~

1. 세션을 만들고 파일을 업로드한다.
2. 파일 원본은 R2, 메타데이터는 analysis_files에 저장한다.
3. 텍스트가 chunk와 embedding으로 변환된다.
4. AI 단계가 검색 근거와 사용자 입력을 사용한다.
5. 결과 JSON과 비용 이벤트가 D1에 저장된다.

### 5.2 회의록

~~~mermaid
flowchart LR
    REC[브라우저 녹음·Clova] --> CR[clova_recordings]
    CR --> SUM[/api/ai/summarize/]
    TXT[전사 텍스트] --> SUM
    SUM --> AI[AI provider]
    AI --> M[meetings 메타]
    AI --> R2[(R2 Markdown)]
    AI --> UE[usage_events]
    M --> H[history]
    M --> K[Kanban·GitHub issue]
~~~

### 5.3 Garden 빌드·배포

~~~mermaid
sequenceDiagram
    actor User as 사용자
    participant UI as Garden UI
    participant W as Worker API
    participant D as D1 gardens/garden_builds
    participant R as R2
    participant Run as Garden Runner
    participant Pages as Cloudflare Pages

    User->>UI: 자료·제목·label·경로 선택
    UI->>W: POST /api/gardens
    W->>D: gardens.status = draft
    User->>UI: 빌드 요청
    UI->>W: POST /api/gardens/:id/build
    W->>D: garden_builds.status = queued
    Run->>W: POST /api/garden-runner/builds/next
    W->>D: queued -> running
    Run->>W: config/manifest 조회
    W->>R: 패키지 반환
    Run->>Run: 자료 수집·HTML/Markdown 생성
    Run->>Pages: Pages 배포
    Run->>W: callback
    W->>D: running -> succeeded/failed
    UI->>W: gardens/builds 재조회
~~~

1. 설정 저장은 draft 상태를 만든다.
2. 빌드 요청은 별도의 queued 실행을 만든다.
3. Runner가 claim하면 running으로 전환된다.
4. 성공 시 manifest·artifact·site URL이 기록된다.
5. 실패 시 error_message와 failed 상태가 기록된다.
6. source.issuesDir는 결과 URL의 폴더 prefix를 결정한다.

### 5.4 사용량·쿼터

~~~mermaid
flowchart LR
    REQ[AI 또는 Proxy 요청] --> QUOTA{quota 검사}
    QUOTA -->|허용| PROVIDER[외부 AI]
    QUOTA -->|초과| ERR[429]
    PROVIDER --> E[usage_events]
    E --> L[usage_limits]
    E --> A[usage_alerts]
    E --> DASH[series·breakdown·dashboard·export]
~~~

## 6. 인증과 운영 권한

1. sid JWT가 있으면 로그인 사용자로 식별한다.
2. sid가 없으면 aid 익명 기기로 사용량을 구분한다.
3. requireLogin API는 익명 요청을 401로 거부한다.
4. 조직 API는 멤버와 admin/member 역할을 검사한다.
5. GitHub repo/project/issue API는 GitHub OAuth token이 추가로 필요하다.
6. Garden Runner API는 사용자 세션이 아닌 별도 Bearer token을 사용한다.
7. R2와 D1을 함께 쓰는 기능은 원본과 메타데이터의 삭제·재시도 정책을 함께 관리해야 한다.
8. AI·OAuth·Pages·메일 secret은 Worker secret이며 문서에 실제 값을 쓰지 않는다.

## 7. 운영자가 코드를 읽는 순서

1. app/wrangler.jsonc: Worker와 Cloudflare binding
2. app/src/index.ts: 라우팅과 인증 경계
3. app/src/auth.ts, jwt.ts: OAuth·이메일·쿠키
4. app/src/sdui.ts: UI tree 생성
5. app/public/assets/sdui-engine.js: 브라우저 renderer
6. app/public/assets/sdui-*.js: 페이지 plugin
7. app/migrations/0013_ui_metadata.sql: SDUI 기본 seed
8. app/migrations/0030_gardens_sdui.sql: Garden seed와 tables
9. app/src/analysis.ts, gardens.ts, usage.ts: 핵심 도메인
10. templates/garden-runner/build-garden.mjs: 결과 파일·artifact·Pages 흐름

## 8. 운영 체크리스트

- 원격 D1 migration 적용 상태 확인
- ui_metadata의 parent_node_id와 order_index 검증
- 새 API의 user_id 범위 및 권한 검사 확인
- R2 원본과 D1 metadata 정합성 확인
- Vectorize 장애 시 fallback 정책 확인
- Garden queued 작업의 Runner token·callback·cleanup 상태 확인
- 실제 Pages URL은 성공 callback 후 확정
- 공개 문서에 secret·OAuth 값·개인 자료를 넣지 않기

## 결론

이 프로젝트는 다음 세 축으로 이해하면 된다.

1. **SDUI 축**: D1 ui_metadata가 화면 설계도를 제공하고, 브라우저 엔진과 페이지 플러그인이 화면을 완성한다.
2. **업무 데이터 축**: D1이 계정·상태·메타데이터를 관리하고 R2/Vectorize가 파일·검색을 보완한다.
3. **자동화 축**: Worker API가 AI·GitHub·Garden Runner·외부 서비스를 연결하고, usage_events와 권한 검사가 실행을 감싼다.

화면을 바꾸려면 ui_metadata와 플러그인 관계를 먼저 보고, 데이터 기능을 바꾸려면 index.ts 라우트 → 도메인 모듈 → migration/R2 흐름을 함께 확인해야 한다.
