# Claude를 이용한 AI SDUI 생성 가이드

> 확인 기준일: 2026-07-19. 모델 이름·한도·가격은 바뀔 수 있으므로 운영 변경 전 공식 문서를 다시 확인한다.

이 문서는 Claude가 분석 결과를 만들도록 요청하는 방법을 설명한다. 결과를 신뢰하거나 렌더링하는 보안 경계는 `planning-harness.ai-sdui.v1` 서버 검증기이며, 프롬프트만으로 대체하지 않는다.

## 모델 선택

현재 Anthropic의 역할 구분은 다음과 같다. 실제 선택은 대표 프롬프트와 평가셋으로 정확도·엣지 케이스·지연·비용을 비교해 결정한다. 최신 목록과 기능은 [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview), 선택 원칙은 [Choosing the right model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model)에서 재확인한다.

| 작업 | 2026-07-19 기본 후보 |
|---|---|
| 최고 성능·장기 에이전트 | Claude Fable 5 |
| 복잡한 에이전틱 코딩·기업 업무 | Claude Opus 4.8 |
| 일반 제품 기능·속도/지능 균형 | Claude Sonnet 5 |
| 분류·추출·대량 저지연 작업 | Claude Haiku 4.5 |

모델을 바꾸기 전에 지원 모델의 `effort` 조정도 평가한다. 모델 ID와 검증일을 함께 기록하고 Models API의 capabilities와 입출력 한도를 확인한다.

## 구조화 출력

- 최종 응답은 단순한 “JSON으로 답해” 프롬프트 대신 `output_config.format`의 `json_schema`를 사용한다.
- 도구 인자는 필요한 도구에만 `strict: true`를 적용한다.
- 모든 객체는 `additionalProperties: false`로 닫고 enum은 대소문자만 다른 값을 만들지 않는다.
- `stop_reason`이 `refusal` 또는 `max_tokens`이면 스키마 일치를 성공으로 간주하지 않는다.
- 생성 결과는 SDK 검증을 통과했더라도 하네스 서버에서 다시 검증한다.

세부 제약과 지원 범위는 [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)를 따른다.

## 프롬프트 캐싱

- `tools -> system -> messages` 순으로 정적 도구·정책·큰 예시를 앞에 두고 사용자별 입력은 뒤에 둔다.
- 우선 최상위 `cache_control: { type: "ephemeral" }` 자동 캐싱을 사용하고, 변경 주기가 다른 큰 구간만 block-level breakpoint로 분리한다.
- cache hit은 prefix가 동일해야 하므로 타임스탬프나 사용자별 값을 정적 구간에 넣지 않는다.
- 운영에서 cache creation/read/input token을 각각 계측한다.

TTL, 최소 토큰, 무효화 조건은 [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)과 [tool caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)에서 재확인한다.

## 도구와 스킬 정의

도구 설명에는 무엇을 하는지, 언제 쓰고 쓰지 않는지, 각 인자의 영향, 반환하지 않는 정보를 명시한다. 관련 동작은 무제한 도구 이름 대신 좁은 `action` enum으로 묶고, 애플리케이션이 입력·권한·실행 결과를 검증한다. Claude는 tool call을 제안할 뿐 client tool을 직접 실행하지 않는다. [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools), [How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)

스킬은 `name`과 구체적인 trigger 설명을 가진 `SKILL.md`를 사용하고, 핵심 절차는 짧게 유지한다. 큰 계약·예시·스크립트는 필요할 때만 읽히는 reference와 scripts로 분리한다. 시간에 민감한 모델 표는 스킬 본문에 고정하지 않는다. [Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

## 하네스 안전 경계

1. Claude/Codex 등 제공자 결과를 공통 `aiResultCard` 후보로 정규화한다.
2. JSON Schema, component catalog, action catalog 순으로 전체 문서를 검증한다.
3. 위험 작업은 기존 server-issued dry-run job과 일치하는 `approvalCard`만 허용한다.
4. 승인은 owner·operation·payload hash·expiry를 서버에서 다시 확인하는 원자적 상태 전이다.
5. 검증된 canonical 결과만 전용 renderer에 전달한다.
6. 거부 로그에는 code/path/hash만 남기고 raw 모델 응답이나 비밀은 저장하지 않는다.

프롬프트, 브라우저 상태, 숨겨진 버튼, 모델의 “승인됨” 문구는 권한 증명이 아니다.
