# Google/Naver SEO 운영 절차

대상 서비스는 `https://harness-meeting-app.kibayerin.workers.dev`이며, 구현·운영 이슈는 [#121](https://github.com/feed-mina/planning-harness/issues/121)에서 추적한다.

## 저장소에서 자동 확인되는 항목

- `npm run build:seo`: `public/assets/public-pages.json`과 공개 HTML을 검증하고 `public/sitemap.xml`, `public/assets/public-pages.js`를 생성한다.
- `npm run check:seo`: 공개 페이지의 단일·고유 `title`, `description`, H1, canonical, trailing slash와 생성 파일 일치 여부를 확인한다.
- `npm test`: 공개/비공개 페이지, 분석 스크립트 순서, robots 정책을 계약 테스트로 확인한다.
- 배포 명령은 사이트맵을 먼저 재생성한다.

공개 색인 URL은 `/`, `/feature/`, `/dev-setup/`, `/ask-todo-hub/`, `/stock/` 다섯 개다. 목록은 `public/assets/public-pages.json`에서 관리하며, 실제 `noindex` 상태 및 HTML 경로와 다르면 SEO 검사에서 실패한다. 로그인·개인 데이터 페이지는 HTML `noindex, nofollow` 또는 인증 리다이렉트로 제외한다. `robots.txt`에서는 `/api/`만 차단한다. `noindex` 페이지를 robots에서 동시에 막으면 검색 로봇이 메타 태그를 읽지 못하므로 두 규칙을 중복 적용하지 않는다.

## 배포 후 확인

1. `/robots.txt`와 `/sitemap.xml`이 200인지 확인한다.
2. 공개 페이지의 고유 `title`, `description`, `canonical`, Open Graph, Twitter card, H1을 확인한다.
3. 비공개 페이지 HTML에 `noindex, nofollow`가 있는지 확인한다.
4. Search Console URL 검사와 Naver URL 진단에서 공개 다섯 URL을 점검한다.
5. 모바일 Lighthouse SEO와 Core Web Vitals를 점검한다.

## Google Search Console

1. URL prefix 속성으로 서비스 URL을 등록한다.
2. 발급된 `google-site-verification` 값을 공개 페이지 `<head>`의 verification 주석 위치에 넣는다.
3. `/sitemap.xml`을 제출한다.
4. 공개 URL 다섯 개를 URL 검사로 확인하고 색인을 요청한다.
5. 주 1회 페이지 색인, 검색 실적, Core Web Vitals 오류를 확인한다.

공식 문서: [소유권 확인](https://support.google.com/webmasters/answer/9008080), [사이트맵 관리](https://support.google.com/webmasters/answer/7451001)

## Naver Search Advisor

1. 사이트를 등록하고 발급된 `naver-site-verification` 값을 공개 페이지 주석 위치에 넣는다.
2. robots.txt 검증에서 `Yeti`가 공개 페이지를 읽을 수 있는지 확인한다.
3. `/sitemap.xml`을 제출한다.
4. 공개 URL의 제목·설명 중복, 수집 상태, 색인 상태를 매주 확인한다.

공식 가이드: [네이버 검색 SEO 기본 가이드](https://searchadvisor.naver.com/guide/seo-basic-intro)

## 콘텐츠 운영 규칙

- 새 공개 랜딩 페이지에는 고유 title, description, H1, canonical을 추가하고 `public/assets/public-pages.json`에 trailing slash 경로를 등록한다.
- 개인·관리 화면에는 `noindex, nofollow`를 추가하고 canonical은 만들지 않는다.
- URL을 삭제할 때는 내부 링크와 사이트맵을 먼저 정리하고, 대체 URL이 있으면 301을 사용한다.
- 검색 유입용 문서는 실제 사용자의 질문을 해결하는 내용으로 작성하고, 동일 키워드의 얇은 페이지를 양산하지 않는다.
- 월 1회 `site:harness-meeting-app.kibayerin.workers.dev` 결과와 Search Console/Naver 보고서를 비교한다.
