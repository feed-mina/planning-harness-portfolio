import type { Env } from "./env";

interface ProxyKeyRow {
  id: string;
  user_id: string;
  org_id: string | null;
  device_id: string;
  name: string;
  key_prefix: string;
  status: "active" | "revoked";
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function now(): string {
  return new Date().toISOString();
}

function randomBase64Url(bytes = 24): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(arr, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeName(value: unknown): string {
  return String(value || "내 기기").trim().replace(/\s+/g, " ").slice(0, 80) || "내 기기";
}

function requestedOrgId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const orgId = value.trim();
  return orgId || null;
}

async function requireActiveOrgMembership(env: Env, userId: string, value: unknown): Promise<string | null> {
  const orgId = requestedOrgId(value);
  if (!orgId) return null;
  const membership = await env.DB.prepare(
    "SELECT 1 AS active FROM organization_members WHERE org_id=? AND user_id=? AND status='active'"
  ).bind(orgId, userId).first<{ active: number }>();
  if (!membership) {
    throw Object.assign(new Error("조직 접근 권한이 없습니다."), { status: 403, code: "org_forbidden" });
  }
  return orgId;
}

function setupGuide(env: Env, key: string) {
  const base = (env.APP_BASE_URL || "").replace(/\/+$/, "");
  return {
    base_url: base,
    key,
    anthropic: {
      ANTHROPIC_BASE_URL: `${base}/api/proxy/anthropic`,
      ANTHROPIC_API_KEY: key,
    },
    openai: {
      OPENAI_BASE_URL: `${base}/api/proxy/openai/v1`,
      OPENAI_API_KEY: key,
    },
    gemini: {
      GEMINI_BASE_URL: `${base}/api/proxy/gemini/v1beta`,
      GEMINI_API_KEY: key,
    },
    shell: [
      `setx ANTHROPIC_BASE_URL "${base}/api/proxy/anthropic"`,
      `setx ANTHROPIC_API_KEY "${key}"`,
      `setx OPENAI_BASE_URL "${base}/api/proxy/openai/v1"`,
      `setx OPENAI_API_KEY "${key}"`,
      `setx GEMINI_BASE_URL "${base}/api/proxy/gemini/v1beta"`,
      `setx GEMINI_API_KEY "${key}"`,
    ],
  };
}

function publicDevice(row: ProxyKeyRow) {
  return {
    id: row.id,
    device_id: row.device_id,
    name: row.name,
    key_prefix: row.key_prefix,
    status: row.status,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  };
}

async function insertProxyKey(env: Env, userId: string, name: string, orgId: string | null = null) {
  const id = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const prefix = randomBase64Url(5);
  const key = `ph_live_${prefix}_${randomBase64Url(24)}`;
  const keyHash = await sha256(key);
  const ts = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO proxy_keys (id, user_id, org_id, device_id, name, key_prefix, key_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    ).bind(id, userId, orgId, deviceId, name, prefix, keyHash, ts),
    env.DB.prepare(
      `INSERT INTO user_devices (device_id, user_id, first_seen_at, linked_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         user_id=excluded.user_id,
         linked_at=excluded.linked_at,
         last_seen_at=excluded.last_seen_at`
    ).bind(deviceId, userId, ts, ts, ts),
  ]);
  return { device: { id, device_id: deviceId, name, key_prefix: prefix, status: "active", created_at: ts }, proxy_key: key };
}

export async function listProxyDevices(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, org_id, device_id, name, key_prefix, status, created_at, last_used_at, revoked_at
     FROM proxy_keys WHERE user_id=? ORDER BY created_at DESC LIMIT 100`
  ).bind(userId).all<ProxyKeyRow>();
  return { devices: (results || []).map(publicDevice) };
}

export async function createProxyDevice(env: Env, userId: string, body: unknown) {
  const rec = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const orgId = await requireActiveOrgMembership(env, userId, rec.org_id);
  const created = await insertProxyKey(env, userId, normalizeName(rec.name), orgId);
  return { ...created, setup: setupGuide(env, created.proxy_key) };
}

export async function revokeProxyDevice(env: Env, userId: string, id: string) {
  const ts = now();
  const result = await env.DB.prepare(
    "UPDATE proxy_keys SET status='revoked', revoked_at=? WHERE id=? AND user_id=? AND status='active'"
  ).bind(ts, id, userId).run();
  return { ok: result.meta.changes > 0 };
}

export async function createDeviceRegistrationCode(env: Env, userId: string, body: unknown) {
  const rec = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const orgId = await requireActiveOrgMembership(env, userId, rec.org_id);
  const code = randomCode();
  const ts = now();
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO device_registration_codes (code, user_id, org_id, device_name, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(code, userId, orgId, normalizeName(rec.name), expires, ts).run();
  return {
    code,
    expires_at: expires,
    registration_url: `${(env.APP_BASE_URL || "").replace(/\/+$/, "")}/mypage/?device_code=${encodeURIComponent(code)}`,
  };
}

export async function claimDeviceRegistrationCode(env: Env, code: string, body: unknown) {
  const rec = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const row = await env.DB.prepare(
    "SELECT code, user_id, org_id, device_name, expires_at, consumed_at FROM device_registration_codes WHERE code=?"
  ).bind(code.toUpperCase()).first<{ code: string; user_id: string; org_id: string | null; device_name: string | null; expires_at: string; consumed_at: string | null }>();
  if (!row) throw Object.assign(new Error("등록 코드를 찾을 수 없습니다."), { status: 404 });
  if (row.consumed_at) throw Object.assign(new Error("이미 사용된 등록 코드입니다."), { status: 409 });
  if (new Date(row.expires_at).getTime() < Date.now()) throw Object.assign(new Error("등록 코드가 만료되었습니다."), { status: 410 });
  const created = await insertProxyKey(env, row.user_id, normalizeName(rec.name || row.device_name), row.org_id);
  await env.DB.prepare(
    "UPDATE device_registration_codes SET consumed_at=? WHERE code=?"
  ).bind(now(), row.code).run();
  return { ...created, setup: setupGuide(env, created.proxy_key) };
}

export async function authenticateProxyKey(env: Env, key: string) {
  const match = key.match(/^ph_live_([A-Za-z0-9_-]{7})_[A-Za-z0-9_-]{32}$/);
  if (!match) return null;
  const hash = await sha256(key);
  const row = await env.DB.prepare(
    `SELECT id, user_id, org_id, device_id, name, key_prefix, status, created_at, last_used_at, revoked_at
     FROM proxy_keys WHERE key_prefix=? AND key_hash=? AND status='active'`
  ).bind(match[1], hash).first<ProxyKeyRow>();
  if (!row) return null;
  const ts = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE proxy_keys SET last_used_at=? WHERE id=?").bind(ts, row.id),
    env.DB.prepare("UPDATE user_devices SET last_seen_at=? WHERE device_id=?").bind(ts, row.device_id),
  ]);
  return { userId: row.user_id, deviceId: row.device_id, orgId: row.org_id, keyId: row.id, name: row.name };
}
