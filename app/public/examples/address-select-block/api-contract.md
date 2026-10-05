# Address Select Block API Contract

This example defines the minimum API and adapter contract for the `address-select-block` pilot.

## Scope

- No secret key values are stored in this package.
- The current editor repository `feed-mina/sdui-template-kit-productization` was not accessible when this draft was created.
- The contract is derived from `feed-mina/SDUI` and `feed-mina/KMovement` static code only.

## Endpoints

### `GET /api/ui/ADDRESS_SELECT_BLOCK`

- Purpose: load the page metadata or preview configuration for the block
- Auth: public metadata or role-filtered preview
- Response: block metadata tree or compiled preview payload

### `POST /api/address/preview/mock-select`

- Purpose: return deterministic mock address data for editor preview
- Auth: studio preview only
- Request body:

```json
{
  "provider": "mock"
}
```

- Response body:

```json
{
  "zipCode": "06236",
  "roadAddress": "서울특별시 강남구 테헤란로 123",
  "detailAddress": ""
}
```

### `POST /api/address/provider/select`

- Purpose: adapter-owned runtime selection handoff
- Auth: runtime adapter specific
- Request body:

```json
{
  "provider": "web-daum",
  "state": "searching"
}
```

- Response body:

```json
{
  "event": "ADDRESS_SELECTED",
  "value": {
    "zipCode": "06236",
    "roadAddress": "서울특별시 강남구 테헤란로 123",
    "detailAddress": "4층"
  }
}
```

## Event contract

- `OPEN_POSTCODE`: request provider open
- `ADDRESS_SELECTED`: provider returned an address
- `ADDRESS_CLEARED`: user cleared the block
- `INPUT_CHANGED`: detail address changed
- `ERROR`: provider failed or returned unusable data
