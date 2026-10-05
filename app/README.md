# app/ — 회의록 메이커 Cloudflare 앱 (Epic #3, M1)

회의록 메이커를 **Cloudflare Workers(Static Assets) + D1 + R2** 위에 올린 멀티페이지 앱.
LLM 키는 **서버 secret**에 두고, 사용자는 provider만 선택한다. (기존 `docs/` 정적 버전을 대체 예정)

## 구성
```
app/
├── wrangler.jsonc         # 바인딩(Assets/D1/R2) + vars
├── migrations/0001_init.sql
├── src/
│   ├── index.ts           # 라우터 (/api/* 만 Worker, 나머지 정적)
│   ├── ai.ts              # 멀티 provider 프록시 (claude/openai/Gemini API) + 토큰 usage
│   ├── usage.ts           # 토큰→원 환산, D1 기록, 일 한도(500원)
│   ├── agentSubscriptions.ts # 에이전트 구독·provider 고유 윈도우 수동 관측
│   └── jwt.ts             # 서명 쿠키(JWT) 세션
└── public/                # 정적 멀티페이지
    ├── index.html         # 대시보드
    ├── feature/           # 회의록 만들기 (키 UI 없음, provider 선택)
    ├── stats/             # 사용량 통계
    ├── mypage/            # 마이페이지 (로그인 게이트)
    └── assets/            # styles.css, common.js, feature.js
```

## API
| 라우트 | 설명 |
|---|---|
| `POST /api/stt/clova` | `multipart/form-data`의 `media` 오디오 파일 → Clova Speech 전사 텍스트. Clova 키는 Worker secret에서만 사용 |
| `POST /api/ai/summarize` | `{transcript,date,time,attendees,subject,provider?,model?}` → 회의록 Markdown + usage + 비용. 일 한도 초과 시 429 |
| `GET /api/settings` | 현재 provider·model·custom_prompt(+기본 프롬프트 템플릿) |
| `PUT /api/settings` | provider·model·custom_prompt 저장 (**로그인 필요**) |
| `GET /api/usage` | 현재 예산 구간 사용 비용/한도/잔여, 오늘 누적, 리셋 횟수, Gemini·GPT·Claude별 비용 |
| `POST /api/usage/reset` | 현재 예산 구간을 마감하고 일 한도를 다시 채움. 오늘 사용 기록은 보존 (**로그인 필요**) |
| `GET /api/usage/series?days=14` | 일자별 비용/토큰 + provider별 비용 (통계 차트) |
| `GET /api/usage/breakdown?days=30` | 입력/출력/캐시 토큰 분해 + 모델별 비용/요청 수 |
| `GET /api/usage/cost-dashboard?period=day\|week\|month` | 기간별 비용 합계·추세·provider/model 분해·예산 소진율 |
| `GET /api/usage/subjects?days=30` | 현재 계정 또는 익명 기기 범위의 사용량 집계 |
| `GET /api/usage/requests?days=30&limit=50` | 현재 계정 또는 익명 기기의 최근 사용 요청 이력 |
| `GET /api/usage/export?days=30` | 로그인 사용자의 최근 30일 사용량 CSV 내보내기 |
| `GET /api/agent-subscriptions` | Claude·Codex·Copilot 구독과 provider 고유 사용 윈도우 조회 (**로그인 필요**) |
| `PUT/DELETE /api/agent-subscriptions/:provider` | 구독 갱신일·플랜 수동 등록/수정 또는 구독과 관측값 삭제 (**로그인 필요**) |
| `PUT /api/agent-subscriptions/:provider/windows/:window` | 잔여량·리셋 시각 수동 관측 UPSERT (**로그인 필요**) |
| `GET/POST /api/orgs` | 로그인 사용자의 조직 목록 조회 / 조직 생성 |
| `GET /api/orgs/:id` | 조직 상세, 멤버, 초대 목록(관리자만 전체) |
| `POST /api/orgs/:id/invites` | 조직 멤버 초대 생성 (**관리자 필요**) |
| `PATCH/DELETE /api/orgs/:id/members/:userId` | 멤버 역할 변경 / 제거 (**관리자 필요**) |
| `GET /api/orgs/:id/usage?period=day\|week\|month` | 조직 관리자 전체 계정/기기 비용, 일반 멤버 본인 비용 |
| `GET /api/orgs/:id/usage/export?period=month` | 조직 관리자 전용 최근 30일 사용량 CSV 내보내기 |
| `GET/POST /api/proxy/devices` | 프록시 기기 목록 조회 / 기기별 프록시 키 발급 |
| `POST /api/proxy/device-codes` | 다른 컴퓨터 등록용 15분 코드 생성 |
| `POST /api/proxy/device-codes/:code/claim` | 로그인 없이 등록 코드로 프록시 키 발급 |
| `GET/PUT /api/time-settings` | 로그인 사용자의 기본 타임존, 근무 시간, 반복 요일 조회 / 저장 |
| `GET/POST /api/time-blocks` | 날짜별 시간 블록 조회 / 생성 (`date`, `start_time`, `end_time`, `kind`) |
| `DELETE /api/time-blocks/:id` | 날짜별 시간 블록 삭제 |
| `GET/POST /api/content/posts` | 로그인 사용자의 콘텐츠 목록 조회 / 게시물 생성 |
| `GET/PATCH/DELETE /api/content/posts/:id` | 콘텐츠 상세 조회 / 수정 / 삭제 |
| `GET/POST /api/content/posts/:id/assets` | 콘텐츠 첨부 파일 목록 조회 / R2 업로드 |
| `GET/DELETE /api/content/posts/:id/assets/:assetId` | 첨부 파일 다운로드 / 삭제 |
| `GET /api/me` | 세션(로그인 여부) |
| `GET /api/auth/github` · `/callback` · `/logout` | GitHub OAuth 로그인/콜백/로그아웃 |
| `POST /api/auth/email/register` · `/login` | 이메일/비밀번호 가입·로그인. 로그인 성공 시 현재 익명 기기의 사용량을 계정으로 이관 |
| `GET /api/auth/connected-app/authorize` | 로그인된 Harness 사용자가 정확히 등록된 connected app에 120초 PKCE 코드를 발급. 비로그인 사용자는 서명된 host-only resume cookie로 로그인 후 고정 resume 경로에 복귀 |
| `POST /api/auth/connected-app/token` | 별도 backchannel secret을 가진 서버만 코드를 교환. 사용자 ID와 issuer/audience/environment가 포함된 최소 assertion만 반환하며 CORS를 허용하지 않음 |
| `GET /api/health` | 헬스체크 |

### AI provider·모델·프롬프트
- 기능 페이지와 마이페이지에서 provider/model을 선택할 수 있습니다. Gemini는 **Gemini API(Google AI Studio)** 를 사용합니다.
- **커스텀 프롬프트**: 마이페이지에서 편집. 플레이스홀더 `{{date}} {{time}} {{subject}} {{attendees}} {{transcript}}`.
  기본 템플릿은 `src/ai.ts` 의 `DEFAULT_PROMPT_TEMPLATE`. 비우고 저장하면 기본으로 복귀.

### 에이전트 구독 관측 (Issue #151 Phase 1)

- 마이페이지 설정에서 Claude, Codex, GitHub Copilot 카드의 플랜·다음 갱신일·잔여량·리셋 시각을 직접 입력합니다.
- 이 데이터는 Harness 내부 API 비용 추정치인 `/api/usage` 및 `usage_events`와 분리됩니다. 제공자 화면의 구독 한도를 API 토큰 비용으로 환산하지 않습니다.
- 모든 카드에 이슈 인수조건의 `daily`·`weekly` 슬롯을 표시합니다. Claude/Codex의 `daily`, Copilot의 `daily`·`weekly`는 현재 공식 확인 가능한 독립 잔여치가 없어 `unsupported`로 고정하고 저장을 막습니다. 실제 입력 윈도우는 Claude/Codex의 `rolling_5h`·`weekly`, Copilot의 `monthly`입니다.
- 값이 없으면 `0`이 아니라 `unconfigured`/`unsupported`로 반환합니다. `resets_at`이 지나면 잔여량을 `null`로 숨기고 `stale`로 바꾸며, 한도가 가득 찼다고 자동 추정하지 않습니다.
- UPSERT는 `verified_at`/`observed_at`이 더 최신일 때만 적용합니다. 같은 요청의 재전송이나 오래된 로컬 관측은 최신 값을 덮어쓰지 않습니다.
- 수집 출처 계약은 `manual | provider_api | local_bridge`이지만 Phase 1 공개 API와 UI는 `manual`만 허용합니다. 나머지 출처는 향후 신뢰된 내부 어댑터 경계를 위한 값이며, 공식 API/로컬 브리지/스케줄 수집은 Phase 2 후속 작업입니다.
- 쿠키, 인증 토큰, 비밀번호, 브라우저 프로필·세션 정보는 입력으로 거부하며 저장하지 않습니다.

### GitHub OAuth 설정 (마이페이지 로그인)
1. GitHub → Settings → Developer settings → **OAuth Apps → New**.
   - Homepage: `<APP_BASE_URL>`  ·  **Authorization callback URL: `<APP_BASE_URL>/api/auth/callback`**
2. `wrangler.jsonc` 의 `vars.GITHUB_OAUTH_CLIENT_ID` 와 `vars.APP_BASE_URL` 채우기.
3. `wrangler secret put GITHUB_OAUTH_CLIENT_SECRET`, `wrangler secret put JWT_SECRET`.

### Connected app 로그인 연동

이 흐름은 Harness의 `sid` 쿠키나 `JWT_SECRET`을 다른 호스트와 공유하지 않습니다. 브라우저는
Harness의 top-level authorize 경로를 방문하고, connected app 서버가 PKCE verifier와 일회용
`exchange_id`를 별도 인증된 backchannel에서 교환합니다. D1에는 authorization code와
`exchange_id`의 SHA-256 해시만 저장됩니다.

- 환경별로 `CONNECTED_APP_CLIENT_ID`, `CONNECTED_APP_AUDIENCE`,
  `CONNECTED_APP_SCOPE`, `CONNECTED_APP_REDIRECT_URI`를 정확한 값으로 설정합니다.
- `issuer`는 `APP_BASE_URL`의 origin, `environment`는 `ANALYTICS_ENVIRONMENT`에서 서버가
  결정합니다. 요청의 값이 하나라도 다르면 코드를 발급하거나 교환하지 않습니다.
- `CONNECTED_APP_BACKCHANNEL_SECRET`는 최소 32자 랜덤 secret이며 JWT/OAuth secret과
  분리합니다. production과 staging에도 서로 다른 값을 사용합니다.
- `CONNECTED_APP_AUTH_ENABLED`의 기본값은 두 환경 모두 `false`입니다. `0096` D1
  migration, secret, 정확한 redirect/issuer 설정과 staging 검증을 마친 뒤 해당 환경만
  명시적으로 `true`로 전환합니다.
- authorize resume은 오직
  `/api/auth/connected-app/authorize/resume`으로만 돌아옵니다. 임의 `next` URL을
  실행하지 않습니다.

```bash
npx wrangler secret put CONNECTED_APP_BACKCHANNEL_SECRET
npx wrangler secret put CONNECTED_APP_BACKCHANNEL_SECRET --env staging
```

## 배포 준비물 — 어디서 받나
| 항목 | 발급처 | 비고 |
|---|---|---|
| Cloudflare 계정 + Wrangler | https://dash.cloudflare.com (가입) → `npx wrangler login` | 무료 플랜 가능 |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → **API Keys** | Claude |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys | codex(OpenAI) |
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey → **Create API key** | Gemini (Google AI Studio). API 키 하나면 동작 |
| `CLOVA_SPEECH_INVOKE_URL` / `CLOVA_SPEECH_SECRET_KEY` | Naver Cloud CLOVA Speech 도메인 | 녹음 파일 STT 프록시. Invoke URL은 `/recognizer/upload?completion=sync` 전체 URL 또는 도메인 Invoke URL |
| `JWT_SECRET` | 직접 생성: `openssl rand -base64 32` | 세션 서명용 랜덤값 |
| GitHub OAuth (CLIENT_ID/SECRET) | https://github.com/settings/developers → **New OAuth App** | 콜백 `<APP_BASE_URL>/api/auth/callback` |

> 키가 없는 provider는 그 provider만 실패하고 나머지는 동작. Gemini는 `GEMINI_API_KEY` secret 하나면 됩니다(별도 프로젝트 ID·리전 불필요).

## 배포 (최초 1회)
```bash
cd app
npm install

# 1) D1 생성 → 출력된 database_id 를 wrangler.jsonc 에 반영
npx wrangler d1 create harness-meeting-db
npx wrangler d1 migrations apply harness-meeting-db --remote

# 2) R2 버킷
npx wrangler r2 bucket create harness-meetings

# 3) Secrets (provider 키 + 세션 + OAuth)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put CLOVA_SPEECH_INVOKE_URL
npx wrangler secret put CLOVA_SPEECH_SECRET_KEY
npx wrangler secret put JWT_SECRET               # 임의 긴 랜덤 문자열
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET   # (M2)
npx wrangler secret put CONNECTED_APP_BACKCHANNEL_SECRET # connected app 전용, JWT secret과 분리
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID         # Garden 72시간 후 Pages 정리
npx wrangler secret put CLOUDFLARE_PAGES_API_TOKEN    # Pages 프로젝트 삭제 권한

# 4) 배포
npx wrangler deploy
```
로컬 개발: `npx wrangler dev` (로컬 D1은 `--local` 마이그레이션 필요).

## NBlog 운영 API

`/nblog-automation/`은 로그인 보호 화면이며 예시 데이터나 `localStorage`를 운영 원본으로 사용하지 않습니다. `migrations/0076_nblog_operations.sql`을 적용하면 다음 경로가 같은 Worker에서 동작합니다.

- D1: 캠페인 상태, 산출물 버전, 승인, 재시도, 인계 체크포인트, 발행 결과, 감사 이력, 프롬프트 버전, CLI 토큰 해시
- R2: 로컬 산출물과 사용자가 명시적으로 업로드한 미디어
- Workflows: 실패 재시도 시 저장된 산출물과 체크포인트 무결성 재확인
- 운영 화면: 상세 검증, 제목·본문·태그 복사, 미디어 순서, 스마트에디터 수동 인계, 발행 URL 등록

```powershell
npm.cmd run db:migrate:local
npm.cmd run typecheck
npm.cmd test
npx wrangler deploy --dry-run
```

로컬 CLI 토큰은 로그인된 운영 화면의 `CLI 연결`에서 발급하며 원문을 한 번만 표시합니다. D1에는 SHA-256 해시만 저장하고 네이버 비밀번호, 쿠키, 브라우저 프로필 또는 세션 토큰을 받지 않습니다.

## 비용/쿼터
- `vars.DAILY_LIMIT_KRW`(기본 500) — 사용자/일 한도. 초과 시 `/api/ai/summarize` 가 429.
- 단가표는 `src/usage.ts` 의 `PRICE_KRW_PER_1M` — **실제 공시 단가로 조정**(현재는 근사치).
- 사용량 관계 모델과 대표 쿼리는 `docs/usage-schema.md`에 정리되어 있습니다.
- 사용량 보존 기간은 30일입니다. 새 사용량 기록 시 30일보다 오래된 `usage_events`/`usage_alerts`를 정리합니다.
- 예산 임계치/한도 초과 알림 채널은 이메일입니다. 사용자는 마이페이지에서 이메일 알림 수신을 끌 수 있습니다.
- 실제 이메일 발송에는 SendGrid API key secret(`SENDGRID_API_KEY`)과 검증된 발신 주소 secret(`ALERT_EMAIL_FROM`) 설정이 필요합니다. 자세한 설정은 `docs/sendgrid-email.md`를 참고하세요.
- 계정/기기 식별자는 화면과 CSV에서 기본 마스킹합니다. 익명 기기 drilldown은 조직 관리자에게만 노출됩니다.

## 프록시 기기 등록
- 마이페이지 → 설정 → 프록시 기기 등록에서 기기별 프록시 키를 발급합니다.
- Claude Code CLI 예시: `ANTHROPIC_BASE_URL=<APP_BASE_URL>/api/proxy/anthropic`, `ANTHROPIC_API_KEY=<발급 키>`.
- OpenAI 호환 클라이언트 예시: `OPENAI_BASE_URL=<APP_BASE_URL>/api/proxy/openai/v1`, `OPENAI_API_KEY=<발급 키>`.
- Gemini API 클라이언트 예시: `GEMINI_BASE_URL=<APP_BASE_URL>/api/proxy/gemini/v1beta`, `GEMINI_API_KEY=<발급 키>`.
- 발급 키 원문은 한 번만 표시되고 DB에는 SHA-256 해시와 prefix만 저장됩니다.
- 게이트웨이는 `/api/proxy/anthropic/*`, `/api/proxy/openai/*`, `/api/proxy/gemini/*` 요청을 provider API로 전달하고 `usage_events.source='proxy'`로 요청/토큰/비용을 기록합니다.

## 마일스톤 (Epic #3)
- **M1 (현재)**: 프록시 + 기능 페이지(#2 흡수) + D1 사용량/쿼터 ✅ 스캐폴드
- M2: GitHub OAuth + 마이페이지 게이트  ·  M3: R2 회의록 저장/이력
- M4: 통계 차트(경량 라이브러리)  ·  M5: git 연동(repo/project/assignee 선택)

## 알려진 미완 (M1 스캐폴드)
- `/api/auth/github`(OAuth) 미구현 → 현재는 익명 쿠키(`aid`)로 사용량 집계.
- 오디오 파일 STT 프록시는 Clova Speech secret 등록 후 동작(자막·실시간 녹음 fallback 유지).
- 단가표·모델 목록은 배포 시점 기준으로 확인/조정 필요.
