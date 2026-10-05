export const AI_SDUI_SCHEMA = "planning-harness.ai-sdui.v1" as const;
export const AI_SDUI_MAX_BYTES = 64 * 1024;
export const AI_SDUI_AUDIT_RETENTION_DAYS = 30;
export const AI_SDUI_AUDIT_MAX_PER_USER = 1000;

export const AI_SDUI_COMPONENT_TYPES = [
  "aiResultCard",
  "textBlock",
  "metricCard",
  "statusBadge",
  "approvalCard",
  "actionGroup",
] as const;

export const AI_SDUI_ACTION_TYPES = [
  "OPEN_REQUIREMENTS",
  "OPEN_EVIDENCE",
  "OPEN_JOB",
  "OPEN_ARTIFACT",
  "ENQUEUE_ANALYSIS",
  "ENQUEUE_RETRY",
  "APPROVE_JOB",
  "MODIFY_CODE",
  "PUSH_CHANGES",
  "DEPLOY",
  "DELETE_RESOURCE",
] as const;

export const AI_SDUI_RISKY_OPERATIONS = [
  "MODIFY_CODE",
  "PUSH_CHANGES",
  "DEPLOY",
  "DELETE_RESOURCE",
] as const;

export const AI_SDUI_PROVIDERS = ["claude", "codex", "copilot", "other"] as const;
export const AI_SDUI_QUEUE_STATUSES = ["pending", "running", "completed", "failed", "blocked"] as const;

const SAFE_REFERENCE_ACTIONS = [
  "OPEN_REQUIREMENTS",
  "OPEN_EVIDENCE",
  "OPEN_JOB",
  "OPEN_ARTIFACT",
  "ENQUEUE_ANALYSIS",
  "ENQUEUE_RETRY",
] as const;

type AiSduiStage = "request" | "structure" | "catalog" | "action" | "approval" | "accepted";
type ComponentType = typeof AI_SDUI_COMPONENT_TYPES[number];
type RiskyOperation = typeof AI_SDUI_RISKY_OPERATIONS[number];
type Provider = typeof AI_SDUI_PROVIDERS[number];
type SafeReferenceActionType = typeof SAFE_REFERENCE_ACTIONS[number];

type UnknownRecord = Record<string, unknown>;

interface GenericAction {
  id: string;
  type: string;
  label: string;
  ref_id?: string;
  job_id?: string;
  operation?: string;
  payload_hash?: string;
}

interface GenericComponent {
  id: string;
  type: string;
  props: UnknownRecord;
  actions?: GenericAction[];
}

interface GenericEnvelope {
  schema: typeof AI_SDUI_SCHEMA;
  result_id: string;
  generated_at: string;
  source: {
    provider: Provider;
    model?: string;
  };
  card: GenericComponent & {
    children: GenericComponent[];
    actions: GenericAction[];
  };
}

export interface AiSduiEnv {
  DB: D1Database;
}

interface ApprovalJobRow {
  id: string;
  user_id: string;
  operation: RiskyOperation;
  payload_hash: string;
  status: "pending" | "approved" | "revoked";
  dry_run: number;
  server_check_required: number;
  expires_at: string;
  approved_at: string | null;
}

interface ReadJsonResult {
  value: unknown;
  payloadSha256: string;
}

export class AiSduiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly stage: AiSduiStage,
    message: string,
  ) {
    super(message);
    this.name = "AiSduiError";
  }
}

const componentTypes = new Set<string>(AI_SDUI_COMPONENT_TYPES);
const actionTypes = new Set<string>(AI_SDUI_ACTION_TYPES);
const riskyOperations = new Set<string>(AI_SDUI_RISKY_OPERATIONS);
const safeReferenceActions = new Set<string>(SAFE_REFERENCE_ACTIONS);
const providers = new Set<string>(AI_SDUI_PROVIDERS);
const queueStatuses = new Set<string>(AI_SDUI_QUEUE_STATUSES);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const payloadHashPattern = /^[0-9a-f]{64}$/;

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
      ...(init?.headers || {}),
    },
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structureError(): never {
  throw new AiSduiError(400, "invalid_structure", "structure", "AI SDUI payload does not match the required structure.");
}

function exactKeys(value: UnknownRecord, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) structureError();
}

function requiredString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") structureError();
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) structureError();
  return normalized;
}

function identifier(value: unknown): string {
  const normalized = requiredString(value, 128);
  if (!idPattern.test(normalized)) structureError();
  return normalized;
}

function isoTimestamp(value: unknown): string {
  const normalized = requiredString(value, 64);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) structureError();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] || hour > 23 || minute > 59 || second > 59) {
    structureError();
  }
  if (match[7] !== "Z") {
    const offsetHour = Number(match[7].slice(1, 3));
    const offsetMinute = Number(match[7].slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) structureError();
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) structureError();
  return parsed.toISOString();
}

function sha256Hex(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}

async function readBoundedJson(request: Request, maxBytes = AI_SDUI_MAX_BYTES): Promise<ReadJsonResult> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new AiSduiError(415, "unsupported_media_type", "request", "Content-Type must be application/json.");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw new AiSduiError(400, "invalid_content_length", "request", "Content-Length is invalid.");
    }
    if (declared > maxBytes) {
      throw new AiSduiError(413, "payload_too_large", "request", "AI SDUI payload is too large.");
    }
  }

  if (!request.body) {
    throw new AiSduiError(400, "invalid_json", "request", "A JSON request body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel("payload limit exceeded");
      } catch {
        // The size rejection must remain stable even when the sender already
        // aborted the request stream while cancellation was in flight.
      }
      throw new AiSduiError(413, "payload_too_large", "request", "AI SDUI payload is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const payloadSha256 = await sha256Hex(bytes);

  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return { value: JSON.parse(text), payloadSha256 };
  } catch {
    throw new AiSduiError(400, "invalid_json", "request", "Request body must be valid UTF-8 JSON.");
  }
}

function validateGenericAction(value: unknown): GenericAction {
  if (!isRecord(value)) structureError();
  exactKeys(value, ["id", "type", "label", "ref_id", "job_id", "operation", "payload_hash"]);
  const action: GenericAction = {
    id: identifier(value.id),
    type: requiredString(value.type, 64),
    label: requiredString(value.label, 120),
  };
  if (value.ref_id !== undefined) action.ref_id = identifier(value.ref_id);
  if (value.job_id !== undefined) action.job_id = identifier(value.job_id);
  if (value.operation !== undefined) action.operation = requiredString(value.operation, 64);
  if (value.payload_hash !== undefined) action.payload_hash = requiredString(value.payload_hash, 64);
  return action;
}

function validateGenericComponent(value: unknown): GenericComponent {
  if (!isRecord(value)) structureError();
  exactKeys(value, ["id", "type", "props", "actions"]);
  if (!isRecord(value.props)) structureError();
  const component: GenericComponent = {
    id: identifier(value.id),
    type: requiredString(value.type, 64),
    props: value.props,
  };
  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions) || value.actions.length > 8) structureError();
    component.actions = value.actions.map(validateGenericAction);
  }
  return component;
}

function validateStructure(value: unknown): GenericEnvelope {
  if (!isRecord(value)) structureError();
  exactKeys(value, ["schema", "result_id", "generated_at", "source", "card"]);
  if (value.schema !== AI_SDUI_SCHEMA) {
    throw new AiSduiError(409, "schema_mismatch", "structure", "AI SDUI schema version is not supported.");
  }
  if (!isRecord(value.source)) structureError();
  exactKeys(value.source, ["provider", "model"]);
  const provider = requiredString(value.source.provider, 32);
  if (!providers.has(provider)) structureError();
  const source: GenericEnvelope["source"] = { provider: provider as Provider };
  if (value.source.model !== undefined) source.model = requiredString(value.source.model, 120);

  if (!isRecord(value.card)) structureError();
  exactKeys(value.card, ["id", "type", "props", "children", "actions"]);
  if (!isRecord(value.card.props)) structureError();
  exactKeys(value.card.props, ["title", "summary", "status"]);
  const status = requiredString(value.card.props.status, 32);
  if (!queueStatuses.has(status)) structureError();
  const cardProps: UnknownRecord = {
    title: requiredString(value.card.props.title, 200),
    summary: requiredString(value.card.props.summary, 4000),
    status,
  };
  if (!Array.isArray(value.card.children) || value.card.children.length > 32) structureError();
  if (!Array.isArray(value.card.actions) || value.card.actions.length > 8) structureError();

  return {
    schema: AI_SDUI_SCHEMA,
    result_id: identifier(value.result_id),
    generated_at: isoTimestamp(value.generated_at),
    source,
    card: {
      id: identifier(value.card.id),
      type: requiredString(value.card.type, 64),
      props: cardProps,
      children: value.card.children.map(validateGenericComponent),
      actions: value.card.actions.map(validateGenericAction),
    },
  };
}

function catalogError(): never {
  throw new AiSduiError(422, "unknown_component", "catalog", "AI SDUI payload contains a component outside the server catalog.");
}

function validateCatalog(envelope: GenericEnvelope): void {
  if (envelope.card.type !== "aiResultCard") catalogError();
  for (const component of envelope.card.children) {
    if (!componentTypes.has(component.type) || component.type === "aiResultCard") catalogError();
  }
}

function actionError(code = "invalid_action"): never {
  throw new AiSduiError(422, code, "action", "AI SDUI payload contains an action that is not allowed in this context.");
}

function catalogPropsError(): never {
  throw new AiSduiError(422, "invalid_component_props", "catalog", "AI SDUI component properties do not match the server catalog.");
}

function componentString(props: UnknownRecord, key: string, maxLength: number): string {
  try {
    return requiredString(props[key], maxLength);
  } catch (error) {
    if (error instanceof AiSduiError) catalogPropsError();
    throw error;
  }
}

function componentId(props: UnknownRecord, key: string): string {
  try {
    return identifier(props[key]);
  } catch (error) {
    if (error instanceof AiSduiError) catalogPropsError();
    throw error;
  }
}

function componentTimestamp(props: UnknownRecord, key: string): string {
  try {
    return isoTimestamp(props[key]);
  } catch (error) {
    if (error instanceof AiSduiError) catalogPropsError();
    throw error;
  }
}

function exactComponentKeys(props: UnknownRecord, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(props).some((key) => !allowedSet.has(key))) catalogPropsError();
}

function validateReferenceAction(action: GenericAction): GenericAction & { type: SafeReferenceActionType; ref_id: string } {
  if (!actionTypes.has(action.type)) actionError("unknown_action");
  if (!safeReferenceActions.has(action.type)) actionError();
  if (!action.ref_id || action.job_id || action.operation || action.payload_hash) actionError();
  return { ...action, type: action.type as SafeReferenceActionType, ref_id: action.ref_id };
}

function validateApproveAction(action: GenericAction): GenericAction & {
  type: "APPROVE_JOB";
  job_id: string;
  operation: RiskyOperation;
  payload_hash: string;
} {
  if (!actionTypes.has(action.type)) actionError("unknown_action");
  if (action.type !== "APPROVE_JOB") actionError();
  if (!action.job_id || !action.operation || !action.payload_hash || action.ref_id) actionError();
  if (!riskyOperations.has(action.operation) || !payloadHashPattern.test(action.payload_hash)) actionError();
  return {
    ...action,
    type: "APPROVE_JOB",
    job_id: action.job_id,
    operation: action.operation as RiskyOperation,
    payload_hash: action.payload_hash,
  };
}

function validateComponentProps(component: GenericComponent): void {
  switch (component.type as ComponentType) {
    case "textBlock":
      exactComponentKeys(component.props, ["text"]);
      component.props = { text: componentString(component.props, "text", 4000) };
      if (component.actions !== undefined) catalogPropsError();
      return;
    case "metricCard": {
      exactComponentKeys(component.props, ["label", "value", "unit"]);
      const normalized: UnknownRecord = {
        label: componentString(component.props, "label", 120),
        value: componentString(component.props, "value", 200),
      };
      if (component.props.unit !== undefined) normalized.unit = componentString(component.props, "unit", 40);
      component.props = normalized;
      if (component.actions !== undefined) catalogPropsError();
      return;
    }
    case "statusBadge": {
      exactComponentKeys(component.props, ["status", "label"]);
      const status = componentString(component.props, "status", 32);
      if (!queueStatuses.has(status)) catalogPropsError();
      const normalized: UnknownRecord = { status };
      if (component.props.label !== undefined) normalized.label = componentString(component.props, "label", 120);
      component.props = normalized;
      if (component.actions !== undefined) catalogPropsError();
      return;
    }
    case "actionGroup": {
      exactComponentKeys(component.props, ["label"]);
      const normalized: UnknownRecord = {};
      if (component.props.label !== undefined) normalized.label = componentString(component.props, "label", 120);
      component.props = normalized;
      if (!component.actions || component.actions.length === 0) actionError();
      component.actions = component.actions.map(validateReferenceAction);
      return;
    }
    case "approvalCard": {
      exactComponentKeys(component.props, [
        "title",
        "summary",
        "job_id",
        "operation",
        "payload_hash",
        "dry_run",
        "server_check_required",
        "expires_at",
      ]);
      const operation = componentString(component.props, "operation", 64);
      const payloadHash = componentString(component.props, "payload_hash", 64);
      if (!riskyOperations.has(operation) || !payloadHashPattern.test(payloadHash)) actionError();
      if (component.props.dry_run !== true) actionError("dry_run_required");
      if (component.props.server_check_required !== true) actionError("server_check_required");
      component.props = {
        title: componentString(component.props, "title", 200),
        summary: componentString(component.props, "summary", 2000),
        job_id: componentId(component.props, "job_id"),
        operation,
        payload_hash: payloadHash,
        dry_run: true,
        server_check_required: true,
        expires_at: componentTimestamp(component.props, "expires_at"),
      };
      if (!component.actions || component.actions.length !== 1) actionError("approval_action_required");
      component.actions = [validateApproveAction(component.actions[0])];
      return;
    }
    default:
      catalogError();
  }
}

function validateActions(envelope: GenericEnvelope): void {
  const ids = new Set<string>([envelope.card.id]);
  envelope.card.actions = envelope.card.actions.map(validateReferenceAction);
  for (const action of envelope.card.actions) {
    if (ids.has(action.id)) actionError("duplicate_id");
    ids.add(action.id);
  }
  for (const component of envelope.card.children) {
    if (ids.has(component.id)) actionError("duplicate_id");
    ids.add(component.id);
    validateComponentProps(component);
    for (const action of component.actions || []) {
      if (ids.has(action.id)) actionError("duplicate_id");
      ids.add(action.id);
    }
  }
}

async function getApprovalJob(env: AiSduiEnv, userId: string, jobId: string): Promise<ApprovalJobRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, operation, payload_hash, status, dry_run,
            server_check_required, expires_at, approved_at
       FROM ai_sdui_approval_jobs
      WHERE id=?1 AND user_id=?2`
  ).bind(jobId, userId).first<ApprovalJobRow>();
}

function approvalError(code: string, status = 409): never {
  throw new AiSduiError(status, code, "approval", "AI SDUI approval state failed server verification.");
}

function verifyApprovalJob(
  row: ApprovalJobRow | null,
  expected: { operation: string; payload_hash: string; expires_at?: string },
  now: string,
): ApprovalJobRow {
  if (!row) approvalError("approval_job_not_found", 422);
  if (row.status !== "pending") approvalError("approval_job_not_pending");
  if (row.dry_run !== 1) approvalError("dry_run_required");
  if (row.server_check_required !== 1) approvalError("server_check_required");
  if (row.operation !== expected.operation || row.payload_hash !== expected.payload_hash) approvalError("approval_job_mismatch");
  const expiresAtMs = Date.parse(row.expires_at);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) approvalError("approval_job_invalid_state");
  if (expected.expires_at && expiresAtMs !== Date.parse(expected.expires_at)) approvalError("approval_job_mismatch");
  if (expiresAtMs <= nowMs) approvalError("approval_job_expired", 410);
  return row;
}

async function validateApprovalJobs(env: AiSduiEnv, userId: string, envelope: GenericEnvelope, now: string): Promise<void> {
  const seenJobs = new Set<string>();
  for (const component of envelope.card.children) {
    if (component.type !== "approvalCard") continue;
    const jobId = String(component.props.job_id);
    if (seenJobs.has(jobId)) approvalError("duplicate_approval_job", 422);
    seenJobs.add(jobId);
    const action = component.actions?.[0];
    if (!action || action.type !== "APPROVE_JOB") actionError("approval_action_required");
    if (
      action.job_id !== jobId ||
      action.operation !== component.props.operation ||
      action.payload_hash !== component.props.payload_hash
    ) approvalError("approval_job_mismatch");
    const row = await getApprovalJob(env, userId, jobId);
    verifyApprovalJob(row, {
      operation: String(component.props.operation),
      payload_hash: String(component.props.payload_hash),
      expires_at: String(component.props.expires_at),
    }, now);
  }
}

function safeResultId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.result_id !== "string") return null;
  const candidate = value.result_id.trim();
  return idPattern.test(candidate) ? candidate : null;
}

function validationEventInsert(
  env: AiSduiEnv,
  input: {
    userId: string;
    resultId: string | null;
    accepted: boolean;
    stage: AiSduiStage;
    reasonCode: string;
    payloadSha256: string | null;
    schemaId: string | null;
    now: string;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO ai_sdui_validation_events
       (id, user_id, result_id, schema_id, accepted, stage, reason_code, payload_sha256, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(
    crypto.randomUUID(),
    input.userId,
    input.resultId,
    input.schemaId,
    input.accepted ? 1 : 0,
    input.stage,
    input.reasonCode,
    input.payloadSha256,
    input.now,
  );
}

function validationEventRetention(env: AiSduiEnv, userId: string, now: string): D1PreparedStatement {
  const cutoff = new Date(Date.parse(now) - AI_SDUI_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return env.DB.prepare(
    `DELETE FROM ai_sdui_validation_events
      WHERE user_id=?1
        AND (
          created_at<?2
          OR id IN (
            SELECT id
              FROM ai_sdui_validation_events
             WHERE user_id=?1
             ORDER BY created_at DESC, rowid DESC
             LIMIT -1 OFFSET ?3
          )
        )`
  ).bind(userId, cutoff, AI_SDUI_AUDIT_MAX_PER_USER);
}

async function logValidationEvent(
  env: AiSduiEnv,
  input: {
    userId: string;
    resultId: string | null;
    accepted: boolean;
    stage: AiSduiStage;
    reasonCode: string;
    payloadSha256: string | null;
    schemaId: string | null;
    now: string;
  },
): Promise<void> {
  await env.DB.batch([
    validationEventInsert(env, input),
    validationEventRetention(env, input.userId, input.now),
  ]);
}

function validationErrorResponse(error: AiSduiError): Response {
  return jsonResponse({
    ok: false,
    error: {
      code: error.code,
      stage: error.stage,
      message: error.message,
    },
  }, { status: error.status });
}

export async function handleAiSduiValidate(request: Request, env: AiSduiEnv, userId: string): Promise<Response> {
  const now = new Date().toISOString();
  let payloadSha256: string | null = null;
  let parsed: unknown = null;
  try {
    const read = await readBoundedJson(request);
    parsed = read.value;
    payloadSha256 = read.payloadSha256;
    const envelope = validateStructure(parsed);
    validateCatalog(envelope);
    validateActions(envelope);
    await validateApprovalJobs(env, userId, envelope, now);
    await logValidationEvent(env, {
      userId,
      resultId: envelope.result_id,
      accepted: true,
      stage: "accepted",
      reasonCode: "accepted",
      payloadSha256,
      schemaId: AI_SDUI_SCHEMA,
      now,
    });
    return jsonResponse({
      ok: true,
      schema: AI_SDUI_SCHEMA,
      validation: { validated: true, validated_at: now },
      result: envelope,
    }, { headers: { "x-ai-sdui-validated": AI_SDUI_SCHEMA } });
  } catch (error) {
    const safeError = error instanceof AiSduiError
      ? error
      : new AiSduiError(500, "internal_error", "request", "AI SDUI validation failed.");
    try {
      await logValidationEvent(env, {
        userId,
        resultId: safeResultId(parsed),
        accepted: false,
        stage: safeError.stage,
        reasonCode: safeError.code,
        payloadSha256,
        schemaId: isRecord(parsed) && parsed.schema === AI_SDUI_SCHEMA ? AI_SDUI_SCHEMA : null,
        now,
      });
    } catch {
      return jsonResponse({ ok: false, error: { code: "audit_unavailable", stage: "request", message: "AI SDUI audit logging is unavailable." } }, { status: 503 });
    }
    return validationErrorResponse(safeError);
  }
}

function validateApprovalRequest(value: unknown): { operation: RiskyOperation; payload_hash: string } {
  if (!isRecord(value)) structureError();
  exactKeys(value, ["operation", "payload_hash"]);
  const operation = requiredString(value.operation, 64);
  const payloadHash = requiredString(value.payload_hash, 64);
  if (!riskyOperations.has(operation) || !payloadHashPattern.test(payloadHash)) structureError();
  return { operation: operation as RiskyOperation, payload_hash: payloadHash };
}

export async function handleAiSduiApprove(
  request: Request,
  env: AiSduiEnv,
  userId: string,
  jobId: string,
): Promise<Response> {
  const now = new Date().toISOString();
  let payloadSha256: string | null = null;
  try {
    if (!idPattern.test(jobId)) {
      throw new AiSduiError(404, "approval_job_not_found", "approval", "Approval job was not found.");
    }
    const read = await readBoundedJson(request, 8 * 1024);
    payloadSha256 = read.payloadSha256;
    const body = validateApprovalRequest(read.value);
    const candidate = await getApprovalJob(env, userId, jobId);
    if (!candidate) {
      throw new AiSduiError(404, "approval_job_not_found", "approval", "Approval job was not found.");
    }
    const row = verifyApprovalJob(candidate, body, now);
    const approvalEventId = crypto.randomUUID();
    const [updated, audited] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE ai_sdui_approval_jobs
            SET status='approved', approved_at=?1
          WHERE id=?2 AND user_id=?3 AND status='pending'
            AND operation=?4 AND payload_hash=?5
            AND dry_run=1 AND server_check_required=1
            AND unixepoch(expires_at)>unixepoch(?1)`
      ).bind(now, jobId, userId, body.operation, body.payload_hash),
      env.DB.prepare(
        `INSERT INTO ai_sdui_validation_events
           (id, user_id, result_id, schema_id, accepted, stage, reason_code, payload_sha256, created_at)
         SELECT ?1, ?2, NULL, ?3, 1, 'accepted', 'approval_granted', ?4, ?5
          WHERE changes()=1`
      ).bind(approvalEventId, userId, AI_SDUI_SCHEMA, payloadSha256, now),
      validationEventRetention(env, userId, now),
    ]);

    const updatedCount = Number(updated.meta.changes || 0);
    const auditedCount = Number(audited.meta.changes || 0);
    if (updatedCount !== 1 || auditedCount !== 1) {
      if (updatedCount !== auditedCount) {
        throw new AiSduiError(500, "approval_audit_mismatch", "approval", "AI SDUI approval audit failed.");
      }
      verifyApprovalJob(await getApprovalJob(env, userId, jobId), body, now);
      approvalError("approval_conflict");
    }
    return jsonResponse({
      ok: true,
      approval: {
        job_id: row.id,
        operation: row.operation,
        payload_hash: row.payload_hash,
        status: "approved",
        approved_at: now,
      },
      execution: { started: false, endpoint_available: false },
    }, { headers: { "x-ai-sdui-approved": "1" } });
  } catch (error) {
    const safeError = error instanceof AiSduiError
      ? error
      : new AiSduiError(500, "internal_error", "approval", "AI SDUI approval failed.");
    try {
      await logValidationEvent(env, {
        userId,
        resultId: null,
        accepted: false,
        stage: safeError.stage,
        reasonCode: safeError.code,
        payloadSha256,
        schemaId: AI_SDUI_SCHEMA,
        now,
      });
    } catch {
      return jsonResponse({ ok: false, error: { code: "audit_unavailable", stage: "request", message: "AI SDUI audit logging is unavailable." } }, { status: 503 });
    }
    return validationErrorResponse(safeError);
  }
}
