const baseUrl = process.env.BASE_URL;

if (!baseUrl || !baseUrl.startsWith("https://")) {
  throw new Error("BASE_URL must be an https URL.");
}

async function expectResponse(label, path, init, expectedStatus, expectedCode) {
  const response = await fetch(new URL(path, baseUrl), init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const code = body?.error?.code || null;
  const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expectedStatuses.includes(response.status) || (expectedCode && code !== expectedCode)) {
    throw new Error(`${label} failed: expected ${expectedStatus}/${expectedCode || "any"}, received ${response.status}/${code || "none"}.`);
  }
  console.log(`${label}: ${response.status}/${code || "no-code"}`);
  return { response, body };
}

const fakeSyncToken = `nbs_${"x".repeat(48)}`;
const fakeUploadToken = `nbu_${"y".repeat(48)}`;
const contractHeaders = { "x-nblog-contract-version": "1.0" };

await expectResponse(
  "anonymous API boundary",
  "/api/campaigns",
  { headers: contractHeaders },
  401,
);
await expectResponse(
  "unknown sync token boundary",
  "/api/campaigns",
  { headers: { ...contractHeaders, authorization: `Bearer ${fakeSyncToken}` } },
  401,
  "invalid_sync_token",
);
await expectResponse(
  "upload query-token rejection",
  `/api/nblog/uploads/00000000-0000-4000-8000-000000000000?token=${fakeUploadToken}`,
  { method: "PUT", headers: { "content-type": "image/jpeg" }, body: new Uint8Array([1]) },
  401,
  "upload_token_required",
);

const validSyncToken = process.env.NBLOG_STAGING_SYNC_TOKEN || "";
const requireValidSyncToken = process.env.REQUIRE_VALID_SYNC_TOKEN === "true";
if (requireValidSyncToken && !/^nbs_[A-Za-z0-9_-]{48}$/.test(validSyncToken)) {
  throw new Error("A valid staging-only NBLOG_STAGING_SYNC_TOKEN is required for the live authorization smoke.");
}

if (validSyncToken) {
  const authorization = `Bearer ${validSyncToken}`;
  const authenticatedHeaders = { ...contractHeaders, authorization };
  const campaignId = process.env.SMOKE_CAMPAIGN_ID || `NB-SECURITY-SMOKE-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
  const idempotencyKey = `${campaignId}:security-smoke`;

  await expectResponse(
    "valid sync token read denial",
    "/api/campaigns",
    { headers: authenticatedHeaders },
    403,
    "sync_token_scope_forbidden",
  );
  await expectResponse(
    "valid sync token approval denial",
    `/api/campaigns/${campaignId}/approve`,
    {
      method: "POST",
      headers: { ...authenticatedHeaders, "content-type": "application/json", "idempotency-key": `${idempotencyKey}:deny` },
      body: JSON.stringify({ confirmed: true }),
    },
    403,
    "sync_token_scope_forbidden",
  );

  await expectResponse(
    "valid sync token campaign write",
    "/api/campaigns",
    {
      method: "POST",
      headers: { ...authenticatedHeaders, "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        campaign_id: campaignId,
        campaign_name: "Staging security smoke",
        campaign_url: "https://example.com/security-smoke",
        place_url: "https://map.naver.com/p/security-smoke",
        visit_date: "2026-07-16",
        visit_notes: "Staging-only authorization and upload boundary verification.",
        tone_profile: "security smoke",
        user_tags: ["security-smoke"],
        source_folder: "source/security-smoke",
      }),
    },
    [200, 201],
  );

  const bytes = new Uint8Array([1, 2, 3]);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const checksum = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const mediaId = `security-smoke-${campaignId.slice(-20)}`;
  const initialized = await expectResponse(
    "valid sync token upload initialization",
    `/api/campaigns/${campaignId}/media/upload-init`,
    {
      method: "POST",
      headers: { ...authenticatedHeaders, "content-type": "application/json", "idempotency-key": `${idempotencyKey}:upload` },
      body: JSON.stringify({ files: [{ media_id: mediaId, original_name: "security-smoke.jpg", content_type: "image/jpeg", size: bytes.byteLength, checksum, order: 1 }] }),
    },
    201,
  );
  const upload = initialized.body?.uploads?.[0];
  if (!upload?.upload_url || !upload?.object_key || !/^Bearer nbu_[A-Za-z0-9_-]{32,}$/.test(upload?.headers?.Authorization || "")) {
    throw new Error("upload initialization did not return the required header-only one-time token.");
  }
  if (new URL(upload.upload_url).search) throw new Error("upload URL must not contain credentials or query parameters.");
  const uploadToken = upload.headers.Authorization.slice("Bearer ".length);
  await expectResponse(
    "live upload query-token rejection",
    `${upload.upload_url}?token=${encodeURIComponent(uploadToken)}`,
    { method: "PUT", headers: { "content-type": "image/jpeg" }, body: bytes },
    401,
    "upload_token_required",
  );
  await expectResponse(
    "live upload authorization header",
    upload.upload_url,
    { method: "PUT", headers: { ...upload.headers, "content-length": String(bytes.byteLength) }, body: bytes },
    200,
  );
  await expectResponse(
    "valid sync token upload completion",
    `/api/campaigns/${campaignId}/media/upload-complete`,
    {
      method: "POST",
      headers: { ...authenticatedHeaders, "content-type": "application/json", "idempotency-key": `${idempotencyKey}:complete` },
      body: JSON.stringify({ files: [{ media_id: mediaId, object_key: upload.object_key }] }),
    },
    200,
  );
}
