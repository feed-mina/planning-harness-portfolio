# Garden Runner 운영·Secret 등록 가이드

> 관련 이슈: [#91](https://github.com/feed-mina/planning-harness/issues/91)
> 관련 workflow: [`.github/workflows/garden-runner.yml`](../.github/workflows/garden-runner.yml)

## 1. GitHub Actions Secret 등록

저장소 관리자 계정으로 다음 경로를 연다.

`GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret`

아래 이름을 정확히 입력한다. 값은 화면·로그·manifest에 출력하지 않는다.

| Secret | 용도 | 최소 권한 원칙 |
|---|---|---|
| `GARDEN_RUNNER_TOKEN` | Worker claim/callback Bearer 인증 | 이 저장소 전용 무작위 값, 다른 OAuth token과 공유하지 않음 |
| `CLOUDFLARE_ACCOUNT_ID` | Pages 프로젝트 계정 식별 | 대상 Cloudflare 계정 ID만 사용 |
| `CLOUDFLARE_PAGES_API_TOKEN` | Pages Direct Upload | Pages 프로젝트 편집에 필요한 최소 scope만 사용 |

`GITHUB_TOKEN`은 workflow가 제공하는 기본 token이 아니라, private source repo를 읽어야 할 때만 별도 secret으로 추가한다. 공개 fixture나 Worker가 만든 content package만 처리할 때는 불필요하다.

## 2. 등록 후 검증

1. `Actions → Garden Runner → Run workflow`를 `main` 대상으로 실행한다.
2. `Install Wrangler`가 성공하는지 확인한다.
3. `Claim, build, and deploy one Garden`이 성공하는지 확인한다.
4. queued Garden이 없으면 성공으로 끝나며 Pages 업로드가 없는 것이 정상이다.
5. queued Garden이 있으면 Worker에서 `running`으로 바뀌고, 성공 시 `succeeded`, `site_url`, 결과 파일 수가 callback에 기록된다.
6. 실패하면 Actions 로그에는 secret 값 대신 상태·오류 원인만 남겨야 한다.

반복 smoke QA는 다음 명령으로 실행한다.

```powershell
cd app
npm.cmd run qa:garden-runner
```

실제 workflow 실행 결과에는 [run 29172945617](https://github.com/feed-mina/planning-harness/actions/runs/29172945617)처럼 run URL을 기록한다.

## 3. 원격 D1 migration

새 migration은 Worker 배포 전에 운영자가 직접 확인하고 적용한다.

```powershell
cd app
npx wrangler d1 migrations list harness-meeting-db --remote
npx wrangler d1 migrations apply harness-meeting-db --remote
```

적용 전에는 새 테이블을 사용하는 Worker를 운영에 배포하지 않는다. 현재 조직-Garden 연결은 `0065_organization_gardens.sql`에 의존한다.

## 4. 상태별 조치

| 상태 | 의미 | 조치 |
|---|---|---|
| queued | Worker가 요청을 저장했고 Runner 대기 중 | 5분 schedule 또는 수동 workflow 실행 |
| running | Runner가 claim 후 처리 중 | 중복 workflow를 실행하지 말고 로그 확인 |
| succeeded | Pages 업로드·callback 완료 | `site_url`과 정적 페이지 원본 링크 확인 |
| failed | 생성·업로드·callback 실패 | 오류 원인 수정 후 force 재빌드 |
| 401 claim | Runner token 불일치/누락 | Secret 이름과 Worker secret을 대조하고 값을 재발급 |
| Pages 403/522 | Access·도메인·Pages 설정 문제 | Access 정책, custom domain, Pages project 상태를 확인 |

## 5. Secret 교체

1. 새 `GARDEN_RUNNER_TOKEN`을 GitHub Secret과 Worker Secret에 각각 등록한다.
2. 두 위치가 같은지 확인한 뒤 workflow를 실행한다.
3. 성공 확인 후 이전 값을 폐기한다.
4. 토큰 값 자체는 이슈·캡처·로그에 기록하지 않고 교체 시각과 run URL만 기록한다.
