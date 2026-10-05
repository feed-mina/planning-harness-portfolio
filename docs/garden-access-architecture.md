# Garden Pages·Cloudflare Access 조직 보호 설계

> 상태: 설계 및 운영 검증 계획 (2026-07-12)
> 관련 이슈: [#105](https://github.com/feed-mina/planning-harness/issues/105)

## 1. 문제와 경계

Planning Harness의 일반 로그인은 Worker API와 마이페이지를 보호한다. Garden은 Runner가 Cloudflare Pages에 정적 파일을 업로드하므로, API의 `sid` JWT를 Pages HTML에 넣거나 URL로 전달해서는 안 된다. Pages URL을 직접 아는 경우에도 조직 밖 사용자가 읽을 수 없어야 한다.

따라서 두 권한을 분리한다.

| 경계 | 책임 | 원본 |
|---|---|---|
| Worker·마이페이지 | Garden 생성·수정·삭제, 조직 멤버십, 링크 노출 | Worker JWT + D1 `organizations`/`organization_members` |
| Pages 정적 사이트 | 실제 문서 열람 차단 | Cloudflare Access 정책 + Access audit log |
| Runner | 정적 산출물 생성·배포 | `GARDEN_RUNNER_TOKEN` 및 Pages API secret |

Worker 세션 토큰과 Runner 토큰은 Pages URL, HTML, `manifest.json`, `garden.config.yaml`에 저장하지 않는다.

## 2. 권장 배포 순서

Cloudflare Pages 공식 절차상 preview 보호와 production `*.pages.dev` 보호는 별도 설정이다.

1. Pages 프로젝트에서 **Settings → General → Enable access policy**를 켜서 preview용 Access 애플리케이션을 만든다.
2. Access 애플리케이션의 public hostname에서 production 호스트를 wildcard가 아닌 실제 호스트로 좁힌다.
3. Preview 보호가 계속 필요하면 Pages 설정에서 preview Access를 다시 활성화해 production과 preview 정책을 둘 다 유지한다.
4. 조직용 custom domain을 쓰면 Pages Custom domain을 먼저 연결한다.
5. 그 뒤 Zero Trust → Access controls → Applications에서 Self-hosted public hostname으로 custom domain을 추가한다.
6. Allow 정책은 조직 IdP 그룹 또는 회사 이메일 도메인으로 제한하고, 필요할 때만 Require(예: MFA/device posture)를 추가한다.
7. 비멤버는 Bypass가 아니라 기본 거부로 처리한다. 공개 endpoint가 필요한 경우에만 별도 Bypass 경로를 검토한다.

공식 참고:

- [Pages preview deployments와 Access](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [`*.pages.dev` 보호 및 custom domain 주의사항](https://developers.cloudflare.com/pages/platform/known-issues/)
- [Access 정책의 Allow/Include/Require/Exclude](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)

## 3. 애플리케이션 연결

Garden row에는 기존 `site_url`을 유지하고, 조직 연결을 다음처럼 표현한다.

```text
organization_members(user_id, org_id, role='admin|member', status='active')
gardens(user_id, site_url, ...)
organization_gardens(org_id, garden_id, visibility='org_private')
```

마이페이지 조직 탭은 다음 순서로 동작한다.

1. 현재 Worker 세션으로 조직 멤버십을 확인한다.
2. 멤버인 조직에 연결된 Garden만 `site_url`과 Access 보호 상태를 표시한다.
3. 링크 클릭은 Pages URL로 이동한다. Worker JWT를 query string, fragment, referrer에 넣지 않는다.
4. Pages Access가 조직 IdP를 다시 확인한다. Worker 로그인과 Access 로그인 계정이 다르면 Access가 거부한다.
5. Garden 삭제·조직 연결 해제 시 마이페이지 링크를 즉시 숨기고, Pages 프로젝트/도메인 정리는 기존 cleanup 정책을 따른다.

`organization_gardens` 연결 테이블과 연결 API는 migration `0065_organization_gardens.sql` 및 커밋 `df0c586`에 구현되었다. 원격 D1 적용 후 Garden 소유자가 연결하고 조직 멤버가 목록을 조회할 수 있다. 반면 Cloudflare Access 보호 상태 자체는 Cloudflare 계정 정책으로 관리하므로 아직 운영 설정·수기 검증 대상이다.

## 4. 검증 매트릭스

| 시나리오 | 기대 결과 | 증거 |
|---|---|---|
| 조직 멤버 + Access 허용 | 마이페이지 링크 표시, Pages 문서 표시 | 브라우저 캡처 + Access audit log |
| 조직 비멤버 | 마이페이지 링크 숨김 또는 403 | API 응답 + 브라우저 캡처 |
| Pages URL 직접 접근 + 비허용 계정 | Access 로그인/거부 | 주소창 캡처 + audit log |
| 로그아웃 후 재접근 | Access 재인증 요구 | 로그아웃·재접근 캡처 |
| Worker 로그아웃만 수행 | Pages Access 세션은 별도 정책에 따라 유지/만료 | 두 세션의 명시적 확인 |
| HTML·manifest 검사 | JWT·OAuth·Runner secret 미포함 | 산출물 grep 결과 |

구현 완료 전에는 `pages.dev`가 공개 상태인 기존 Garden을 조직 전용이라고 표시하지 않는다.
