---
name: generate-sdui
description: Convert an approved AI analysis result from Claude, Codex, or another provider into the planning-harness.ai-sdui.v1 aiResultCard contract. Use when an analysis result must become SDUI cards, queue status, safe navigation actions, or a dry-run-backed approval card without rendering model JSON directly.
---

# Generate SDUI

Treat every model response as untrusted input. Produce a candidate document, validate it, and hand only the validated canonical document to the renderer.

## Read first

1. Read the target repository's `spec.md` and the approved analysis artifact.
2. Read [references/catalog.md](references/catalog.md).
3. Read `../../app/contracts/ai-sdui.v1.schema.json` as the machine contract.
4. Read `../../docs/claude-ai-sdui-guide.md` only when selecting a Claude model, structured-output mode, caching, or tools.

Do not mix this result-card contract with the Studio `feedmina.sdui.template.v1` manifest or the D1 `ui_metadata` tree.

## Workflow

1. Extract only claims supported by the approved analysis and its evidence references.
2. Normalize every provider into one `aiResultCard`; identify the provider in `source.provider` instead of changing the card shape.
3. Represent queue progress with the fixed status values from the schema. Never infer success from a missing or unknown state.
4. Use only catalogued components and actions. Do not invent a component, action, URL, executor, or job kind.
5. For `MODIFY_CODE`, `PUSH_CHANGES`, `DEPLOY`, or `DELETE_RESOURCE`, reference an existing server-issued dry-run job in an `approvalCard`. Never invent `job_id` or `payload_hash`.
6. If no valid server job exists, return a blocked result with a clear human next step; do not emit an executable substitute.
7. Save the candidate as `outputs/<today>/ai-sdui.json` and validate it:

   ```text
   node <skill-dir>/scripts/validate_ai_sdui.mjs outputs/<today>/ai-sdui.json
   ```

8. Stop on any schema, component, action, approval, or provenance error. Report the exact path and reason.
9. Present a dry-run summary. Rendering or approval may proceed only through the server validation endpoint.

## Output rules

- Set `schema` to `planning-harness.ai-sdui.v1`.
- Keep text factual, bounded, and free of secrets, tokens, cookies, or raw prompts.
- Use stable evidence or job references, not arbitrary external URLs.
- Keep all object properties within the JSON Schema; additional properties are forbidden.
- Treat `APPROVE_JOB` as a request for a server-side state transition, never as permission to execute the requested operation.

## Completion report

Return:

- candidate file path;
- validation result;
- provider and queue status;
- safe actions;
- approval jobs that still require a person;
- blocked or unsupported facts.

Do not claim that code, push, deploy, or deletion occurred. This skill creates and validates a presentation contract only.
