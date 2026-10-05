# 무료 분석·마케팅 운영 설계

구현 이슈: [#121](https://github.com/feed-mina/planning-harness/issues/121)

## 목표와 도구 역할

| 목적 | 무료 도구 | 기준 지표 |
| --- | --- | --- |
| 검색 노출 | Google Search Console, Naver Search Advisor | 노출, 클릭, CTR, 평균 순위, 색인 오류 |
| 행동·전환 | Google Analytics 4 | 공개 페이지 방문, 회의록 생성, 가입, 재방문 |
| 태그 운영 | Google Tag Manager | 캠페인·실험 태그의 배포 이력 |
| 경량 트래픽 | Cloudflare Web Analytics | 방문·성능의 독립 교차 검증 |
| UX 진단 | Microsoft Clarity | 비로그인·비민감 랜딩의 이탈 구간 |

초기 핵심 퍼널은 `검색/캠페인 유입 → 회의록 만들기 CTA → 입력 시작 → 생성 성공 → 가입/로그인 → 칸반 또는 GitHub 이슈 생성`이다.

## 개인정보 보호 기준

- 선택 분석은 기본 거부 상태이며 사용자가 동의한 뒤에만 제3자 스크립트를 불러온다.
- 회의 원문, 제목, 참석자, 이메일, GitHub 사용자명, 오류 메시지, 검색어, URL 쿼리는 이벤트에 넣지 않는다.
- 이벤트명과 파라미터는 `public/assets/analytics.js`의 허용목록만 통과한다.
- 공개 계측 경로는 `public/assets/public-pages.json` 한 곳에서 관리하며 `/`, `/feature/`, `/dev-setup/`, `/ask-todo-hub/`, `/stock/`만 페이지뷰와 공개 태그 대상이다.
- URL은 origin과 pathname만 전송한다. OAuth 측정용 쿼리는 페이지뷰 전에 제거한다.
- Clarity는 로그아웃 상태의 `/`, `/dev-setup/`, `/ask-todo-hub/`에서만 로드한다. 회의 입력 페이지 `/feature/`에서는 세션 재생을 사용하지 않는다.
- 동의를 철회하면 스크립트를 내리기 위해 페이지를 새로 고친다.

## 설정 순서

1. GA4 웹 데이터 스트림을 만들고 측정 ID(`G-...`)를 발급한다.
2. 필요할 때만 GTM 컨테이너(`GTM-...`)를 만든다.
3. Cloudflare 대시보드 Web Analytics에서 사이트를 추가하고 토큰을 확인한다.
4. Clarity 프로젝트를 만들고 프로젝트 ID를 확인한다.
5. `app/wrangler.jsonc`의 공개 식별자 주석을 실제 값으로 바꾸고 `ANALYTICS_ENABLED`를 `true`로 변경한다.
6. staging에서 동의 전/거부 후 네트워크 요청이 없는지, 동의 후 이벤트가 한 번만 발생하는지 확인한 뒤 production을 활성화한다.

식별자는 공개 값이며 secret이 아니다. 그러나 서버가 정해진 ID 형식만 브라우저에 내려보내므로 임의 문자열을 넣지 않는다.

```jsonc
"ANALYTICS_ENABLED": "true",
"ANALYTICS_ENVIRONMENT": "production",
"GA4_MEASUREMENT_ID": "G-XXXXXXXXXX",
"GTM_CONTAINER_ID": "GTM-XXXXXXX",
"CLOUDFLARE_WEB_ANALYTICS_TOKEN": "PUBLIC_TOKEN",
"CLARITY_PROJECT_ID": "PROJECT_ID"
```

공식 문서: [GA4 설정](https://support.google.com/analytics/answer/9304153), [GTM 설치](https://support.google.com/tagmanager/answer/6103696), [Google Consent Mode](https://developers.google.com/tag-platform/security/guides/consent), [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/get-started/), [Clarity 설정](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup)

## GTM 중복 방지

GA4 ID가 있으면 앱이 GA4 이벤트를 직접 전송한다. GTM에는 같은 GA4 구성 태그나 동일 이벤트 전달 태그를 다시 만들지 않는다. GTM에는 앱이 `harness_<event_name>` 형식의 custom event를 넣으므로 향후 비GA 태그나 제한된 실험에만 사용한다. 중복 여부는 GA4 DebugView와 브라우저 Network 탭에서 이벤트당 요청 한 건으로 확인한다.

## 이벤트 사전

| 이벤트 | 허용 파라미터 | 발생 조건 |
| --- | --- | --- |
| `page_view` | `page_type` | 공개 네 페이지 조회 |
| `cta_click` | `page_type`, `cta_id` | 명시된 CTA 클릭 |
| `file_download` | `asset_type` | 안전한 설치 파일·가이드·회의록 다운로드 |
| `sign_up`, `login` | `method` | 인증 완료 후 로그인 상태 확인 |
| `meeting_input_start` | `input_method` | 텍스트·자막·음성·녹음 입력 시작 |
| `meeting_generate_success` | `input_method` | AI 회의록 생성 성공 |
| `meeting_generate_error` | `error_category` | `quota`, `auth`, `validation`, `server`, `network`, `other` |
| `kanban_create_success` | 없음 | 칸반 카드 생성 성공 |
| `github_issue_create_success` | 없음 | GitHub 이슈 묶음 생성 성공 |

## 대시보드와 주간 리포트

Looker Studio 무료 대시보드는 GA4와 Search Console을 연결해 다음 다섯 영역만 먼저 만든다.

1. 검색: Google/Naver 노출·클릭·CTR·상위 쿼리와 랜딩
2. 획득: source/medium/campaign별 사용자와 가입
3. 활성화: `meeting_input_start → meeting_generate_success` 전환율
4. 가치: 생성 성공 후 칸반/GitHub 후속 전환율
5. 품질: 생성 오류 범주, 기기별 이탈, Core Web Vitals

주간 회의에서는 총량보다 전주 대비 변화와 원인을 기록한다. 데이터가 적을 때는 일별 수치 대신 4주 이동 합계를 함께 본다.

## 캠페인 UTM 규칙

- `utm_source`: 채널/플랫폼 소문자 (`naver`, `google`, `github`, `newsletter`)
- `utm_medium`: 방식 (`organic`, `cpc`, `social`, `referral`, `email`)
- `utm_campaign`: `yyyyqN_목표_대상` 형식 (`2026q3_meeting_notes_developers`)
- `utm_content`: 소재 구분에만 사용하고 개인 식별자를 넣지 않는다.
- 동일 캠페인의 철자와 대소문자를 바꾸지 않는다.

## 출시 전 QA

- `npm test`, `npm run typecheck`, `npm run check:seo`, `npx wrangler deploy --dry-run`이 통과한다.
- 분석 비활성 상태에서 제3자 도메인 요청과 동의 UI가 없다.
- 최초 공개 방문에서 동의 UI의 키보드 조작과 포커스를 확인한다.
- 거부 후 새로고침해도 제3자 요청이 없다.
- 동의 후 GA4 DebugView의 페이지뷰와 전환 이벤트가 한 번씩 나타난다.
- 로그인 화면, 회의 입력, 마이페이지에서 Clarity가 로드되지 않는다.
- URL 쿼리와 입력 본문이 Network payload에 없는지 확인한다.
