# Usage Schema

## 관계 모델

- Account: `users.id`가 내부 계정 ID입니다. OAuth와 이메일 로그인은 `user_identities`로 계정에 연결됩니다.
- Anonymous device: 미로그인 사용자는 `aid` 쿠키를 `anon:<aid>` 사용자 ID로 사용합니다.
- Registered device: 프록시 키 발급 시 `user_devices.device_id`와 `proxy_keys.device_id`가 생성됩니다.
- Organization: `organizations`와 `organization_members`가 계정-조직 관계와 역할을 보관합니다.
- Usage event: 모든 앱/프록시 사용량은 `usage_events` 한 테이블에 저장합니다.

## usage_events 차원

- `user_id`: 비용 소유 계정 또는 익명 기기 ID.
- `org_id`: 조직 비용 집계용 선택 차원.
- `device_id`: 등록 기기별 집계용 선택 차원.
- `proxy_key_id`: 프록시 키 추적용 선택 차원.
- `source`: `app`, `proxy`, `import` 등 수집 출처.
- `provider`, `model`: LLM 제공자와 모델.
- `input_tokens`, `output_tokens`, `cache_tokens`, `cost_krw`: 비용 계산의 핵심 지표.
- `request_id`, `latency_ms`, `status_code`, `error_code`, `metadata_json`: 운영 분석용 메타데이터.

## 대표 집계

기간/provider/model:

```sql
SELECT day, provider, model,
       COUNT(*) AS requests,
       SUM(input_tokens + output_tokens + cache_tokens) AS total_tokens,
       SUM(cost_krw) AS cost_krw
FROM usage_events
WHERE user_id = ? AND day BETWEEN ? AND ?
GROUP BY day, provider, model
ORDER BY day;
```

조직/기기:

```sql
SELECT org_id, device_id,
       COUNT(*) AS requests,
       SUM(cost_krw) AS cost_krw,
       MAX(created_at) AS latest_at
FROM usage_events
WHERE day >= ?
GROUP BY org_id, device_id;
```

프록시 키별:

```sql
SELECT proxy_key_id, provider, model,
       COUNT(*) AS requests,
       SUM(cost_krw) AS cost_krw
FROM usage_events
WHERE source = 'proxy' AND day >= ?
GROUP BY proxy_key_id, provider, model;
```
