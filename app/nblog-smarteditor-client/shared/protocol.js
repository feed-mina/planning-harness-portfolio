(function initNBlogHandoffProtocol(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NBlogHandoffProtocol = api;
})(typeof globalThis === "object" ? globalThis : self, function createNBlogHandoffProtocol() {
  "use strict";

  const CONNECTION_PREFIX = "NBLOG_HANDOFF_V1.";
  const DRAFT_PREFIX = "NBLOG_DRAFT_V1.";
  const CONTRACT_VERSION = "1.1";
  const MAX_CODE_LENGTH = 8_192;
  const MAX_HANDOFF_LIFETIME_MS = 15 * 60 * 1_000;
  const ALLOWED_API_ORIGINS = Object.freeze([
    "https://harness-meeting-app.kibayerin.workers.dev",
    "https://harness-meeting-app-staging.kibayerin.workers.dev",
  ]);
  const CONNECTION_KEYS = Object.freeze([
    "api_origin",
    "claim_path",
    "claim_token",
    "contract_version",
    "expires_at",
    "session_id",
    "version",
  ]);
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CLAIM_TOKEN = /^nbh_[A-Za-z0-9_-]{32,128}$/;
  const SESSION_TOKEN = /^nbhs_[A-Za-z0-9_-]{32,128}$/;
  const CHECKSUM = /^sha256:[a-f0-9]{64}$/i;

  class ProtocolError extends Error {
    constructor(code) {
      super(code);
      this.name = "ProtocolError";
      this.code = code;
    }
  }

  function fail(code) {
    throw new ProtocolError(code);
  }

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function hasExactKeys(value, expected) {
    if (!isRecord(value)) return false;
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
  }

  function decodeBase64Url(segment) {
    if (typeof segment !== "string" || !segment || !/^[A-Za-z0-9_-]+$/.test(segment)) {
      fail("invalid_code_encoding");
    }
    const padding = "=".repeat((4 - (segment.length % 4)) % 4);
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/") + padding;
    let bytes;
    try {
      if (typeof atob === "function") {
        const binary = atob(base64);
        bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      } else if (typeof Buffer !== "undefined") {
        bytes = Uint8Array.from(Buffer.from(base64, "base64"));
      } else {
        fail("base64_decoder_unavailable");
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      fail("invalid_code_encoding");
    }
  }

  function parseEncodedJson(rawCode, prefix) {
    if (typeof rawCode !== "string") fail("invalid_code_type");
    const code = rawCode.trim();
    if (!code.startsWith(prefix) || code.length > MAX_CODE_LENGTH) fail("invalid_code_prefix");
    const segment = code.slice(prefix.length);
    let value;
    try {
      value = JSON.parse(decodeBase64Url(segment));
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      fail("invalid_code_json");
    }
    if (!isRecord(value)) fail("invalid_code_payload");
    return value;
  }

  function parseConnectionCode(rawCode, options = {}) {
    const payload = parseEncodedJson(rawCode, CONNECTION_PREFIX);
    if (!hasExactKeys(payload, CONNECTION_KEYS)) fail("invalid_connection_fields");
    if (payload.version !== 1) fail("unsupported_connection_version");
    if (payload.contract_version !== CONTRACT_VERSION) fail("unsupported_contract_version");
    if (!ALLOWED_API_ORIGINS.includes(payload.api_origin)) fail("api_origin_not_allowed");
    if (!UUID_V4.test(payload.session_id)) fail("invalid_session_id");
    if (!CLAIM_TOKEN.test(payload.claim_token)) fail("invalid_claim_token");

    const expectedClaimPath = `/api/nblog/handoff-sessions/${payload.session_id}/claim`;
    if (payload.claim_path !== expectedClaimPath) fail("claim_path_mismatch");

    const expiresAtMs = Date.parse(payload.expires_at);
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    if (!Number.isFinite(expiresAtMs)) fail("invalid_expiry");
    if (expiresAtMs <= nowMs) fail("connection_expired");
    if (expiresAtMs - nowMs > MAX_HANDOFF_LIFETIME_MS) fail("expiry_too_far");

    return Object.freeze({
      version: 1,
      api_origin: payload.api_origin,
      session_id: payload.session_id.toLowerCase(),
      claim_path: expectedClaimPath,
      claim_token: payload.claim_token,
      contract_version: CONTRACT_VERSION,
      expires_at: new Date(expiresAtMs).toISOString(),
    });
  }

  function normalizeTag(value) {
    const tag = String(value ?? "")
      .trim()
      .replace(/^#+/, "")
      .replace(/[\s,]+/g, "");
    if (!tag || tag.length > 40 || !/^[\p{L}\p{N}_-]+$/u.test(tag)) return "";
    return tag;
  }

  function normalizeTags(value) {
    let candidates = [];
    if (Array.isArray(value)) {
      candidates = value;
    } else if (typeof value === "string") {
      candidates = value.match(/#[^\s#]+/g) || value.split(/[\s,]+/);
    } else if (isRecord(value)) {
      if (Array.isArray(value.final) && value.final.length) candidates = value.final;
      else if (Array.isArray(value.fixed)) candidates = value.fixed;
    }
    const seen = new Set();
    const tags = [];
    for (const candidate of candidates) {
      const tag = normalizeTag(candidate);
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
      if (tags.length === 40) break;
    }
    return tags;
  }

  function extractNaverBlogId(rawUrl, options = {}) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) {
      if (options.required) fail("target_blog_id_missing");
      return null;
    }
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      fail("invalid_target_blog_url");
    }
    if (url.origin !== "https://blog.naver.com" || url.username || url.password) {
      fail("invalid_target_blog_url");
    }

    const rawQueryId = url.searchParams.get("blogId");
    const firstPathSegment = url.pathname.split("/").filter(Boolean)[0] || "";
    let rawPathId = "";
    try {
      rawPathId = firstPathSegment && !firstPathSegment.toLowerCase().endsWith(".naver")
        ? decodeURIComponent(firstPathSegment)
        : "";
    } catch {
      fail("invalid_target_blog_id");
    }
    const candidates = [rawQueryId, rawPathId].filter((value) => value !== null && value !== "");
    const validBlogId = /^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/;
    if (candidates.some((value) => !validBlogId.test(value))) fail("invalid_target_blog_id");
    const normalized = [...new Set(candidates.map((value) => value.toLowerCase()))];
    if (normalized.length > 1) fail("target_blog_id_conflict");
    if (!normalized.length && options.required) fail("target_blog_id_missing");
    return normalized[0] || null;
  }

  function splitTrailingTags(markdown, suppliedTags) {
    const source = String(markdown || "").replace(/\r\n?/g, "\n");
    if (suppliedTags.length) return { body: source, tags: suppliedTags };
    const lines = source.split("\n");
    let lastText = lines.length - 1;
    while (lastText >= 0 && !lines[lastText].trim()) lastText -= 1;
    const trailing = lastText >= 0 ? lines[lastText].trim() : "";
    const isTagLine = /^(?:#[^\s#]+)(?:[ \t]+#[^\s#]+)*$/u.test(trailing);
    if (!isTagLine) return { body: source, tags: [] };
    return {
      body: lines.slice(0, lastText).join("\n").trimEnd(),
      tags: normalizeTags(trailing),
    };
  }

  function draftFromBundle(bundle) {
    if (!isRecord(bundle)) fail("invalid_handoff_bundle");
    if (bundle.schema_version !== CONTRACT_VERSION) fail("unsupported_bundle_version");
    if (!UUID_V4.test(String(bundle.handoff_session_id || ""))) fail("invalid_bundle_session");
    if (!CHECKSUM.test(String(bundle.bundle_checksum || ""))) fail("invalid_bundle_checksum");
    if (!isRecord(bundle.content)) fail("invalid_bundle_content");
    const targetBlogUrl = isRecord(bundle.target) && typeof bundle.target.blog_url === "string"
      ? bundle.target.blog_url.trim()
      : "";
    const targetBlogId = targetBlogUrl
      ? extractNaverBlogId(targetBlogUrl, { required: true })
      : null;

    const title = String(
      bundle.content.selected_title
        || bundle.content.title
        || "",
    ).trim();
    const fallbackMarkdown = String(
      bundle.content.markdown
        || (Array.isArray(bundle.content.body_blocks)
          ? bundle.content.body_blocks.map((block) => isRecord(block) ? String(block.markdown || "") : "").join("\n\n")
          : ""),
    );
    const canonicalBody = typeof bundle.content.body === "string"
      ? bundle.content.body
      : fallbackMarkdown;
    const split = splitTrailingTags(canonicalBody, normalizeTags(bundle.content.tags));
    if (!title || title.length > 300) fail("invalid_draft_title");
    if (!split.body.trim() || split.body.length > 200_000) fail("invalid_draft_body");

    return Object.freeze({
      version: 1,
      handoff_session_id: String(bundle.handoff_session_id).toLowerCase(),
      bundle_checksum: String(bundle.bundle_checksum).toLowerCase(),
      title,
      body: split.body,
      tags: Object.freeze(split.tags),
      target_blog_id: targetBlogId,
      manual_steps: Object.freeze(["login", "captcha", "media", "place", "preview", "publish"]),
    });
  }

  function validateClaimResponse(payload, connection) {
    if (!isRecord(payload)) fail("invalid_claim_response");
    if (payload.contract_version !== CONTRACT_VERSION) fail("unsupported_claim_contract");
    if (!SESSION_TOKEN.test(String(payload.session_token || ""))) fail("invalid_session_token");
    if (!isRecord(payload.handoff_session) || payload.handoff_session.id !== connection.session_id) {
      fail("claim_session_mismatch");
    }
    if (payload.handoff_session.status !== "browser_connected") fail("claim_not_connected");
    const automaticInputAllowed = payload.safety?.automatic_input_allowed;
    const manualActions = payload.safety?.manual_user_actions_required;
    const expectedAutomaticFields = ["body", "tags", "title"];
    const actualAutomaticFields = Array.isArray(automaticInputAllowed)
      ? [...new Set(automaticInputAllowed)].sort()
      : [];
    const requiredManualActions = ["login", "captcha", "media", "place", "preview", "publish"];
    if (!isRecord(payload.safety)
      || payload.safety.stores_naver_credentials !== false
      || payload.safety.final_publish_requires_user_action !== true
      || actualAutomaticFields.length !== expectedAutomaticFields.length
      || !actualAutomaticFields.every((field, index) => field === expectedAutomaticFields[index])
      || !Array.isArray(manualActions)
      || !requiredManualActions.every((action) => manualActions.includes(action))) {
      fail("unsafe_claim_response");
    }
    const draft = draftFromBundle(payload.bundle);
    if (draft.handoff_session_id !== connection.session_id) fail("bundle_session_mismatch");
    const campaignVersion = Number(payload.bundle.campaign_version);
    if (!Number.isInteger(campaignVersion) || campaignVersion < 0) fail("invalid_campaign_version");
    return Object.freeze({
      session_token: String(payload.session_token),
      expires_at: connection.expires_at,
      campaign_version: campaignVersion,
      draft,
    });
  }

  return Object.freeze({
    CONNECTION_PREFIX,
    DRAFT_PREFIX,
    CONTRACT_VERSION,
    ALLOWED_API_ORIGINS,
    ProtocolError,
    parseConnectionCode,
    normalizeTags,
    extractNaverBlogId,
    splitTrailingTags,
    draftFromBundle,
    validateClaimResponse,
  });
});
