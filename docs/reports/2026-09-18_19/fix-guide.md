# planning-harness — fix-guide 수정·검증 지시

한국시간 2026년 9월 18~19일 업데이트 보고서. 활동 집계 마감은 9월 19일 21:24:15입니다.

기획 자료와 화면 템플릿을 관리하는 도구입니다. 이번에는 주소 찾기·선택·상세주소 입력을 하나의 재사용 블록으로 묶는 초안이 들어왔습니다.

| 항목 | 기준 |
|---|---|
| 보고서 범위 | 이번 기간의 변경과 관련 기능. 전체 시스템 설명은 아래 기존 상세 문서로 연결합니다. |
| 확인 브랜치 | main |
| 소스 기준 | `31c2c28f5545` |
| 검증 범위 | 현재 커밋의 예제·카탈로그·내보내기·테스트를 정적으로 대조했고 배포 워크플로 success 기록을 확인했습니다. |
| 보고서 세트 | [쉬운 설명](easy-guide.md) · [수정·검증 지시](fix-guide.md) · [코드 인수인계](screen-code-handover.md) |

## 0. 식별과 상태

**주소 블록 초안과 현재 Studio 실행 규격 대조**

[2026-09-18~19 KST / docs/sdui-address-select-block.md (8,214바이트, 276줄, 파일 지문 aaa582921674) / main]

상태: **호환성 미확인 — 구현 전 점검 지시**. 이번 변경은 보고서 작성이며, 아래 애플리케이션 수정이나 운영 작업은 실행하지 않았습니다.

## 1. 현상

| 기대 | 확인한 실제 상태 |
|---|---|
| 가져온 주소 블록이 현재 편집기에서 지원하는 요소·행동으로 실행돼야 합니다. | 문서는 과거 조사 때 Studio 접근이 불가했다고 명시하고 ADDRESS_BLOCK·어댑터를 초안으로 제안합니다. 카탈로그 등록과 파일 검사만으로 실제 검색이 검증되지는 않습니다. |

## 2. 원인과 근거

조사 기준과 실행 대상의 규격 검증이 아직 분리돼 있습니다. 과거 접근 불가 기록은 역사적 사실로 보존하고 현재 확인 결과를 별도 덧붙여야 합니다.

[기준 소스 열기](https://github.com/feed-mina/planning-harness/blob/31c2c28f5545fa9abab225ddb7ae5690875450c9/docs/sdui-address-select-block.md)

## 3. 수정 위치

- app/public/examples/address-select-block/metadata/address-select-block.screen.json
- app/public/examples/address-select-block/plugins/address-select-block.manifest.json
- app/tests/template-catalog-address-block.test.cjs

## 4. 수정 또는 확인 방법

1. 현재 Studio 버전을 고정하고 manifest 가져오기 검사를 수행합니다.
2. preview mock과 real provider 구현 파일·등록 여부를 확인합니다.
3. 미구현된 부분만 후속 구현하고, 성공·취소·빈 선택·오류를 각각 확인합니다.

## 5. 완료 기준

- [ ] preview에서는 외부 호출 없이 세 주소 필드가 정해진 키로 반환됩니다.
- [ ] real 모드에서 선택·취소·오류 이벤트가 계약과 일치합니다.
- [ ] 웹 키 변환 이후에도 zipCode/roadAddress/detailAddress 의미가 보존됩니다.

## 6. 검증 방법과 제출할 근거

기존 파일·계약 검사를 먼저 실행하고, 대상 Studio의 실제 가져오기 및 주소 선택 테스트를 추가합니다. 현재 보고서에서는 real 동작을 완료로 표시하지 않습니다.

실행 결과·캡처·응답 본문 중 완료 기준에 해당하는 근거를 남깁니다. 미실행 항목은 완료로 표시하지 않습니다.
