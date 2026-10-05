# SDUI Address Select Block Pilot

Status: draft for first reusable feature-block contract  
Date: 2026-09-18

> 조사 범위 메모: `feed-mina/sdui-template-kit-productization` 저장소는 이번 기준으로 접근할 수 없었다. 이 문서는 현재 편집기 저장소를 직접 읽은 결과가 아니라, 접근 가능한 `feed-mina/SDUI` 와 `feed-mina/KMovement` 를 기준선으로 삼아 정리한 초안이다. 실행은 하지 않았으므로 모든 동작 설명은 정적 코드 기준이며 동작 미검증 상태다.

## 목적

주소 검색 → 주소 선택 → 상세주소 입력을 하나의 기능 블록으로 올려서, 편집기 내부에서는 단일 블록으로 관리하고 배포 시에는 각 런타임 규격으로 변환할 수 있게 한다.

이 블록은 다음 조건을 먼저 검증하는 파일럿이다.

1. preview 모드와 real execution 모드를 선언적으로 분리할 수 있는가
2. web SDUI와 mobile 파생 런타임이 같은 입출력 계약을 공유할 수 있는가
3. 개별 컴포넌트 조합을 기능 블록 단위 메타데이터로 승격할 수 있는가

## 접근 범위와 비교 기준

| 항목 | 현재 편집기 저장소 `feed-mina/sdui-template-kit-productization` | `feed-mina/SDUI` | `feed-mina/KMovement` |
|---|---|---|---|
| 접근 상태 | 접근 불가 | 접근 가능 | 접근 가능 |
| 이번 확인 범위 | 미확인 | `main`, `9705ae6c6f5ca23a73d877c563f5e7f49a2b6409` | `main`, `82e0f861d6fc35c17ac11e25e75e503ac541ed45` |
| 역할 | 현재 편집기 후보 | 웹 SDUI 원형 + Spring 백엔드 | Python/AI 본체 + 모바일 SDUI 파생 런타임 |
| 화면 식별 방식 | 미확인 | `screenMap.ts` URL → `screenId` | `PATH_TO_SCREEN` + Expo route |
| 컴포넌트 등록 | 미확인 | `componentMap.tsx` 의 `component_type` 매핑 | `mobileComponentMap.tsx` + `@kride/core` base map |
| 데이터 바인딩 | 미확인 | `ref_data_id` → `pageData` | `ref_data_id` + `useSqlPageData`/`useKpopPageData` |
| 액션 등록 | 미확인 | `action_type` → `useUserActions`/`useBusinessActions` | 대부분 `useBusinessActions` 단일 경로 |
| 미리보기 성격 | 미확인 | `DynamicEngine` 렌더링 계층, `bts-event` JSON 엔진 존재 | 공용 엔진 렌더링 가능 |
| 실제 기능 실행 | 미확인 | `/api/execute/{sqlKey}`, auth, content, AI, google | 로그인/가입/주소검색, K-POP API, 네이티브 화면 |

## 확인한 실제 근거

### SDUI

- 화면 매핑: `metadata-project/components/constants/screenMap.ts`
- 컴포넌트 등록: `metadata-project/components/constants/componentMap.tsx`
- 데이터 바인딩: `metadata-project/components/DynamicEngine/useDynamicEngine.tsx`
- 액션 분기: `metadata-project/components/DynamicEngine/hook/usePageHook.tsx`
- 웹 주소 입력 브리지: `metadata-project/components/fields/AddressSearchGroup.tsx`

### KMovement

- 모바일 컴포넌트 등록: `subproject/SDUI/kride/apps/mobile/src/componentMap.tsx`
- 공용 엔진: `subproject/SDUI/kride/packages/core/src/engine/*`
- 화면 메타데이터 fetch: `subproject/SDUI/kride/packages/core/src/hooks/useUiScreen.ts`
- 모바일 액션 실행: `subproject/SDUI/kride/packages/core/src/hooks/useBusinessActions.ts`

## 선택한 파일럿 블록

선택 블록: `address-select-block`

선정 이유:

1. 사용자가 완료하는 일이 명확하다
2. 입출력과 상태 수가 작아 첫 기능 블록 표준으로 적합하다
3. 웹과 모바일 모두 동일한 사용자 목표를 가진다
4. 외부 provider 의존이 있어 preview/real 분리 기준을 세우기 쉽다

## 블록 정의

사용자 행동:

1. 주소 찾기 버튼을 누른다
2. 주소 검색기를 연다
3. 주소를 선택한다
4. 우편번호와 도로명주소가 채워진다
5. 상세주소를 입력한다
6. 후속 저장/가입/제출 흐름에서 결과를 사용한다

완료 기준:

- `zipCode`
- `roadAddress`
- `detailAddress`

세 값이 블록 출력으로 안정적으로 확보되면 완료다.

## 편집기 공통 계약

### 입력

```json
{
  "value": {
    "zipCode": "",
    "roadAddress": "",
    "detailAddress": ""
  },
  "options": {
    "label": "주소",
    "required": true,
    "provider": "mock",
    "previewMode": true
  }
}
```

### 출력

```json
{
  "onChange": {
    "zipCode": "06236",
    "roadAddress": "서울특별시 강남구 테헤란로 123",
    "detailAddress": "4층"
  },
  "onEvent": {
    "type": "ADDRESS_SELECTED",
    "provider": "web-daum"
  }
}
```

### 이벤트

- `OPEN_POSTCODE`
- `ADDRESS_SELECTED`
- `ADDRESS_CLEARED`
- `INPUT_CHANGED`
- `ERROR`

### 내부 상태

- `idle`
- `searching`
- `selected`
- `error`

## Preview / Real 분리 규칙

### Preview 모드

- 실제 외부 주소 서비스를 호출하지 않는다
- `mock` provider 만 사용한다
- 출력 스키마와 이벤트 흐름만 검증한다
- 레이아웃, label, readonly/editable 구분을 확인한다

### Real 모드

- web SDUI: `web-daum` adapter
- mobile 파생 런타임: `mobile-native` adapter
- 선택 완료 시 form/state 반영까지 수행한다

## 블록 구성 재료

### UI 재료

- label
- zipcode readonly input
- roadAddress readonly input
- detailAddress editable input
- search button
- modal/dialog shell

### 행동 재료

- `OPEN_POSTCODE`
- `ADDRESS_SELECTED`
- `ADDRESS_CLEARED`

### 데이터 재료

- `zipCode`
- `roadAddress`
- `detailAddress`

### 외부 연동 재료

- web: Daum postcode provider
- mobile: native postcode adapter
- preview: mock adapter

## 권장 메타데이터 표현

### 편집기 내부 표현

편집기 내부는 단일 고수준 블록을 사용한다.

```json
{
  "component_type": "ADDRESS_BLOCK"
}
```

이유:

- 편집기 UX가 단순해진다
- preview/real 전환을 옵션으로 선언할 수 있다
- 런타임별 변환기 추가가 쉽다

### 배포 시 SDUI 호환 표현

배포 시에는 아래 조합으로 컴파일한다.

- `GROUP`
- `INPUT`
- `BUTTON`
- `MODAL`
- `action_type: OPEN_POSTCODE`

## 런타임 어댑터 설계

### Web SDUI 어댑터

입력:

- `address-select-block` 설정

출력:

- readonly zipcode input
- search button with `OPEN_POSTCODE`
- readonly roadAddress input
- editable detailAddress input

실행기:

- `AddressSearchGroup.tsx` 또는 동등 renderer
- `PostcodeModal`

### KMovement 파생 어댑터

입력:

- 동일한 블록 설정

출력:

- RN input leaf
- search button
- `navigation.openPostcode(...)`

주의:

- 편집기 표준 키는 `zipCode`, `roadAddress`, `detailAddress`
- web 배포 단계에서만 `zip_code`, `road_address`, `detail_address` 로 변환 가능

## 바로 연결 가능한 부분

- `OPEN_POSTCODE` 이벤트 개념
- 주소 선택 후 내부 상태 갱신 흐름
- readonly 필드와 editable 필드의 역할 분리
- 외부 검색기 결과를 form state로 복사하는 구조

## 수정이 필요한 부분

1. 필드 키 정규화
   - web: `zip_code`, `road_address`, `detail_address`
   - mobile/editor: `zipCode`, `roadAddress`, `detailAddress`
2. preview 전용 mock provider 추가
3. 개별 컴포넌트 조합을 기능 블록 선언으로 승격
4. 취소/실패/빈 선택 상태를 이벤트로 표준화

## 검수 기준

1. 편집기 preview에서 실제 외부 서비스 없이 주소 선택 흐름이 재현되는가
2. real mode에서 web/mobile 각각 provider와 연결되는가
3. 출력 데이터 스키마가 플랫폼과 무관하게 동일한가
4. 후속 저장/가입 로직이 블록 출력만 받아도 연결 가능한가
5. 메타데이터와 문서에 비밀값, 개인정보 샘플, 외부 키가 남지 않는가

## 미확인 사항

- 현재 편집기 저장소의 실제 내부 스키마
- `feed-mina/sdui-template-kit-productization` 의 런타임/미리보기 구조
- SDUI/KMovement 외 다른 재사용 후보 저장소의 중복 여부
- 라이선스 및 재사용 권리 상태

## 다음 단계

1. 현재 편집기 저장소 접근 권한 확보
2. `ADDRESS_BLOCK` 내부 표현이 기존 편집기와 충돌하는지 확인
3. web preview mock adapter 구현
4. SDUI compile target 과 KMovement compile target 을 각각 fixture로 고정
