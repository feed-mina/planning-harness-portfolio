# AI SDUI v1 catalog

The JSON Schema is the final authority. This file explains the security meaning of its fixed values.

## Components

| Type | Purpose |
|---|---|
| `aiResultCard` | Provider-neutral root for one analysis result |
| `textBlock` | Plain explanatory text |
| `metricCard` | A labelled value already supported by evidence |
| `statusBadge` | Queue state: `pending`, `running`, `completed`, `failed`, or `blocked` |
| `approvalCard` | A server-issued dry-run job that still needs a person |
| `actionGroup` | Groups allowlisted actions without changing their authority |

Unknown component types reject the whole document. They are never silently dropped.

## Actions

Safe navigation:

- `OPEN_REQUIREMENTS`
- `OPEN_EVIDENCE`
- `OPEN_JOB`
- `OPEN_ARTIFACT`

Server-routed queue requests:

- `ENQUEUE_ANALYSIS`
- `ENQUEUE_RETRY`

Approval transition:

- `APPROVE_JOB`

Risky operation declarations:

- `MODIFY_CODE`
- `PUSH_CHANGES`
- `DEPLOY`
- `DELETE_RESOURCE`

Risky values are not browser executors. They may appear only as the `operation` of an `approvalCard` backed by an existing server job. The clickable action remains `APPROVE_JOB`.

## Approval invariants

An `approvalCard` must match server state on all of these values:

- authenticated owner;
- `job_id`;
- risky `operation`;
- `payload_hash` for the reviewed dry run;
- pending state;
- unexpired `expires_at`;
- `dry_run: true`;
- `server_check_required: true`.

Approval is a single atomic `pending -> approved` transition. A second approval, stale card, changed payload, cross-user job, or missing job must fail. No dangerous executor is part of this contract.

## Provider normalization

Use `source.provider` values `claude`, `codex`, `copilot`, or `other`. Provider-specific prose may differ, but the root remains `aiResultCard` and the schema does not change.

## Validation order

1. JSON body size and content type
2. JSON Schema and bounded depth/count/text
3. component catalog
4. action catalog
5. approval job state and ownership
6. canonical result returned to the renderer

Record rejection codes and paths without storing the raw model response.
