import type { Env } from "../../env";
import { USAGE_RETENTION_DAYS, getUsageLimitSettings, maskUsageIdentifier } from "../usage";
import { listOrganizationAuditLogs, recordOrganizationAuditLog } from "./orgAudit";

type OrgRole = "admin" | "member";
type CostPeriod = "day" | "week" | "month";

export class OrgError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "org_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface OrgMemberRow {
  user_id: string;
  role: OrgRole;
  status: string;
  github_login?: string | null;
  email?: string | null;
  created_at: string;
}

interface OrgSettings {
  reveal_member_identifiers: boolean;
  allow_raw_usage_export: boolean;
  admin_overage_email_enabled: boolean;
  audit_log_retention_days: number;
}

interface UsageTotalRow {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  cost_krw: number;
}

interface OrgDeviceUsageRow {
  device_key: string;
  owner_user_id: string;
  requests: number;
  total_tokens: number;
  cost_krw: number;
  latest_at: string | null;
}

const ROLE_LABEL: Record<OrgRole, string> = { admin: "관리자", member: "일반" };

const DEFAULT_ORG_AUDIT_RETENTION_DAYS = 90;

function now(): string {
  return new Date().toISOString();
}

function orgSettingsFromRow(row?: Record<string, unknown> | null): OrgSettings {
  const retention = Math.min(365, Math.max(30, Math.round(Number(row?.audit_log_retention_days ?? DEFAULT_ORG_AUDIT_RETENTION_DAYS) || DEFAULT_ORG_AUDIT_RETENTION_DAYS)));
  return {
    reveal_member_identifiers: row?.reveal_member_identifiers !== false && row?.reveal_member_identifiers !== 0,
    allow_raw_usage_export: row?.allow_raw_usage_export === true || row?.allow_raw_usage_export === 1,
    admin_overage_email_enabled: row?.admin_overage_email_enabled !== false && row?.admin_overage_email_enabled !== 0,
    audit_log_retention_days: retention,
  };
}

async function orgSettings(env: Env, orgId: string): Promise<OrgSettings> {
  const row = await env.DB.prepare(
    `SELECT reveal_member_identifiers, allow_raw_usage_export, admin_overage_email_enabled, audit_log_retention_days
     FROM organizations WHERE id=?`
  ).bind(orgId).first<Record<string, unknown>>();
  return orgSettingsFromRow(row);
}

function normalizeOrgSettings(body: unknown, fallback: OrgSettings): OrgSettings {
  const rec = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const valueOrFallback = (key: keyof OrgSettings) => rec[key] ?? fallback[key];
  return {
    reveal_member_identifiers: valueOrFallback("reveal_member_identifiers") !== false,
    allow_raw_usage_export: valueOrFallback("allow_raw_usage_export") === true,
    admin_overage_email_enabled: valueOrFallback("admin_overage_email_enabled") !== false,
    audit_log_retention_days: Math.min(365, Math.max(30, Math.round(Number(valueOrFallback("audit_log_retention_days")) || fallback.audit_log_retention_days))),
  };
}

function normalizeRole(value: unknown): OrgRole {
  return value === "admin" ? "admin" : "member";
}

function normalizeName(value: unknown): string {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name) throw new OrgError(400, "조직 이름을 입력하세요.", "invalid_org_name");
  return name;
}

function normalizeEmail(value: unknown): string {
  const email = String(value || "").trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OrgError(400, "초대 이메일 형식이 올바르지 않습니다.", "invalid_email");
  return email;
}

function normalizePeriod(value?: string | null): CostPeriod {
  return value === "week" || value === "month" ? value : "day";
}

function daysForPeriod(period: CostPeriod): number {
  if (period === "month") return 30;
  if (period === "week") return 7;
  return 1;
}

function dateRange(days: number): { since: string; days: string[] } {
  const items: string[] = [];
  for (let i = days - 1; i >= 0; i--) items.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  return { since: items[0], days: items };
}

function rawAccountIdentifier(row: Pick<OrgMemberRow, "user_id" | "email">): string {
  return row.email || row.user_id;
}

function displayUser(row: Pick<OrgMemberRow, "user_id" | "github_login" | "email">): string {
  if (row.github_login) return row.github_login;
  if (row.email) return `Account ${maskUsageIdentifier(row.email, 4)}`;
  return `Account ${maskUsageIdentifier(row.user_id, 4)}`;
}

async function membership(env: Env, userId: string, orgId: string): Promise<OrgRole | null> {
  const row = await env.DB.prepare(
    "SELECT role FROM organization_members WHERE org_id=? AND user_id=? AND status='active'"
  ).bind(orgId, userId).first<{ role: OrgRole }>();
  return row?.role || null;
}

async function requireMember(env: Env, userId: string, orgId: string): Promise<OrgRole> {
  const role = await membership(env, userId, orgId);
  if (!role) throw new OrgError(403, "조직 접근 권한이 없습니다.", "org_forbidden");
  return role;
}

async function requireAdmin(env: Env, userId: string, orgId: string): Promise<void> {
  const role = await requireMember(env, userId, orgId);
  if (role !== "admin") throw new OrgError(403, "조직 관리자 권한이 필요합니다.", "org_admin_required");
}

interface OrganizationGardenRow {
  garden_id: string;
  title: string;
  status: string;
  site_url: string | null;
  visibility: "org_private";
  created_at: string;
  updated_at: string;
}

export async function listOrganizationGardens(env: Env, userId: string, orgId: string) {
  await requireMember(env, userId, orgId);
  const { results } = await env.DB.prepare(
    `SELECT og.garden_id, g.title, g.status, g.site_url, og.visibility, og.created_at, og.updated_at
     FROM organization_gardens og
     JOIN gardens g ON g.id=og.garden_id
     JOIN organization_members m ON m.org_id=og.org_id AND m.user_id=? AND m.status='active'
     WHERE og.org_id=?
     ORDER BY og.updated_at DESC`
  ).bind(userId, orgId).all<OrganizationGardenRow>();
  return {
    organization_id: orgId,
    gardens: (results || []).map((row) => ({
      garden_id: row.garden_id,
      title: row.title,
      status: row.status,
      site_url: row.site_url,
      visibility: row.visibility,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  };
}

export async function linkGardenToOrganization(env: Env, userId: string, orgId: string, gardenId: string) {
  await requireMember(env, userId, orgId);
  const garden = await env.DB.prepare("SELECT id, user_id, title FROM gardens WHERE id=?").bind(gardenId).first<{ id: string; user_id: string; title: string }>();
  if (!garden) throw new OrgError(404, "Garden을 찾을 수 없습니다.", "garden_not_found");
  if (garden.user_id !== userId) throw new OrgError(403, "Garden 소유자만 조직에 연결할 수 있습니다.", "garden_owner_required");
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO organization_gardens (org_id, garden_id, linked_by, visibility, created_at, updated_at)
     VALUES (?, ?, ?, 'org_private', ?, ?)
     ON CONFLICT(org_id, garden_id) DO UPDATE SET linked_by=excluded.linked_by, visibility='org_private', updated_at=excluded.updated_at`
  ).bind(orgId, gardenId, userId, ts, ts).run();
  await recordOrganizationAuditLog(env, {
    orgId,
    actorUserId: userId,
    action: "org.garden_linked",
    metadata: { garden_id: gardenId, title: garden.title, visibility: "org_private" },
  });
  return { ok: true, org_id: orgId, garden_id: gardenId, visibility: "org_private" as const };
}

export async function unlinkGardenFromOrganization(env: Env, userId: string, orgId: string, gardenId: string) {
  const role = await requireMember(env, userId, orgId);
  const garden = await env.DB.prepare("SELECT id, user_id, title FROM gardens WHERE id=?").bind(gardenId).first<{ id: string; user_id: string; title: string }>();
  if (!garden) throw new OrgError(404, "Garden을 찾을 수 없습니다.", "garden_not_found");
  if (garden.user_id !== userId && role !== "admin") throw new OrgError(403, "조직 관리자 또는 Garden 소유자만 연결을 해제할 수 있습니다.", "garden_unlink_forbidden");
  const existing = await env.DB.prepare("SELECT org_id FROM organization_gardens WHERE org_id=? AND garden_id=?").bind(orgId, gardenId).first<{ org_id: string }>();
  if (!existing) throw new OrgError(404, "조직에 연결된 Garden이 없습니다.", "garden_link_not_found");
  await env.DB.prepare("DELETE FROM organization_gardens WHERE org_id=? AND garden_id=?").bind(orgId, gardenId).run();
  await recordOrganizationAuditLog(env, {
    orgId,
    actorUserId: userId,
    action: "org.garden_unlinked",
    metadata: { garden_id: gardenId, title: garden.title },
  });
  return { ok: true, org_id: orgId, garden_id: gardenId };
}

export async function listGardenOrganizations(env: Env, userId: string, gardenId: string) {
  const garden = await env.DB.prepare("SELECT id, user_id FROM gardens WHERE id=?").bind(gardenId).first<{ id: string; user_id: string }>();
  if (!garden) throw new OrgError(404, "Garden을 찾을 수 없습니다.", "garden_not_found");
  if (garden.user_id !== userId) throw new OrgError(403, "Garden 소유자만 조직 연결을 조회할 수 있습니다.", "garden_owner_required");
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.name, m.role, og.visibility, og.created_at, og.updated_at
     FROM organization_gardens og
     JOIN organizations o ON o.id=og.org_id
     JOIN organization_members m ON m.org_id=og.org_id AND m.user_id=? AND m.status='active'
     WHERE og.garden_id=?
     ORDER BY o.name ASC`
  ).bind(userId, gardenId).all<{ id: string; name: string; role: OrgRole; visibility: "org_private"; created_at: string; updated_at: string }>();
  return { garden_id: gardenId, organizations: results || [] };
}

async function userEmails(env: Env, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT email FROM user_identities WHERE user_id=? AND email IS NOT NULL AND email<>''"
  ).bind(userId).all<{ email: string }>();
  return (results || []).map((row) => row.email.toLowerCase());
}

async function activeMemberRows(env: Env, orgId: string, onlyUserId?: string): Promise<OrgMemberRow[]> {
  const sql = `SELECT m.user_id, m.role, m.status, m.created_at, u.github_login,
       (SELECT email FROM user_identities ui
        WHERE ui.user_id=m.user_id AND ui.email IS NOT NULL AND ui.email<>''
        ORDER BY ui.provider='email' DESC, ui.updated_at DESC
        LIMIT 1) AS email
     FROM organization_members m
     LEFT JOIN users u ON u.id=m.user_id
     WHERE m.org_id=? AND m.status='active'${onlyUserId ? " AND m.user_id=?" : ""}
     ORDER BY m.role='admin' DESC, m.created_at ASC`;
  const stmt = env.DB.prepare(sql);
  const { results } = onlyUserId
    ? await stmt.bind(orgId, onlyUserId).all<OrgMemberRow>()
    : await stmt.bind(orgId).all<OrgMemberRow>();
  return results || [];
}

function memberForApi(row: OrgMemberRow, adminScope = false, revealIdentifiers = false) {
  return {
    user_id: adminScope ? row.user_id : "",
    account_id_masked: maskUsageIdentifier(rawAccountIdentifier(row), 4),
    account_identifier_raw: adminScope && revealIdentifiers ? rawAccountIdentifier(row) : null,
    display_name: displayUser(row),
    role: row.role,
    role_label: ROLE_LABEL[row.role],
    joined_at: row.created_at,
  };
}

export async function listOrganizations(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.name, o.owner_user_id, m.role, o.created_at, o.updated_at,
            (SELECT COUNT(*) FROM organization_members mm WHERE mm.org_id=o.id AND mm.status='active') AS member_count,
            (SELECT COUNT(*) FROM organization_invites ii WHERE ii.org_id=o.id AND ii.status='pending') AS pending_invites
     FROM organization_members m
     JOIN organizations o ON o.id=m.org_id
     WHERE m.user_id=? AND m.status='active'
     ORDER BY o.updated_at DESC`
  ).bind(userId).all<{
    id: string;
    name: string;
    owner_user_id: string;
    role: OrgRole;
    created_at: string;
    updated_at: string;
    member_count: number;
    pending_invites: number;
  }>();
  return { organizations: results || [] };
}

export async function createOrganization(env: Env, userId: string, body: unknown) {
  const rec = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const name = normalizeName(rec.name);
  const id = crypto.randomUUID();
  const ts = now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO organizations (id, name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, name, userId, ts, ts),
    env.DB.prepare(
      "INSERT INTO organization_members (org_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'admin', 'active', ?, ?)"
    ).bind(id, userId, ts, ts),
  ]);
  await recordOrganizationAuditLog(env, {
    orgId: id,
    actorUserId: userId,
    action: "org.created",
    metadata: { name },
  });
  return { id, name, role: "admin" as OrgRole, member_count: 1, pending_invites: 0, created_at: ts, updated_at: ts };
}

export async function getOrganizationDetail(env: Env, userId: string, orgId: string) {
  const role = await requireMember(env, userId, orgId);
  const org = await env.DB.prepare(
    "SELECT id, name, owner_user_id, created_at, updated_at FROM organizations WHERE id=?"
  ).bind(orgId).first<{ id: string; name: string; owner_user_id: string; created_at: string; updated_at: string }>();
  if (!org) throw new OrgError(404, "조직을 찾을 수 없습니다.", "org_not_found");

  const settings = await orgSettings(env, orgId);
  const revealIdentifiers = role === "admin" && settings.reveal_member_identifiers;
  const members = await activeMemberRows(env, orgId, role === "admin" ? undefined : userId);
  const invites = role === "admin"
    ? (await env.DB.prepare(
      `SELECT id, email, role, token, invited_by, status, created_at, accepted_at
       FROM organization_invites WHERE org_id=? ORDER BY created_at DESC LIMIT 50`
    ).bind(orgId).all<{
      id: string;
      email: string;
      role: OrgRole;
      token: string;
      invited_by: string;
      status: string;
      created_at: string;
      accepted_at: string | null;
    }>()).results || []
    : [];

  return {
    viewer_user_id: userId,
    organization: { ...org, role, role_label: ROLE_LABEL[role] },
    settings: role === "admin" ? settings : null,
    policy_recommendation: role === "admin" ? {
      auth_lock_after_failures: 3,
      auth_lock_minutes: 15,
      audit_log_retention_days: DEFAULT_ORG_AUDIT_RETENTION_DAYS,
      csv_raw_export_requires_setting_and_audit_log: true,
    } : null,
    members: members.map((member) => memberForApi(member, role === "admin", revealIdentifiers)),
    invites: invites.map((invite) => ({
      ...invite,
      accept_url: `/mypage/?tab=org&invite=${encodeURIComponent(invite.token)}`,
    })),
  };
}

export async function inviteOrganizationMember(env: Env, userId: string, orgId: string, body: unknown) {
  await requireAdmin(env, userId, orgId);
  const rec = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const email = normalizeEmail(rec.email);
  const role = normalizeRole(rec.role);
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO organization_invites (id, org_id, email, role, token, invited_by, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(id, orgId, email, role, token, userId, ts).run();
  await recordOrganizationAuditLog(env, {
    orgId,
    actorUserId: userId,
    action: "org.member_invited",
    metadata: { email_masked: maskUsageIdentifier(email, 4), role },
  });
  return { id, org_id: orgId, email, role, token, accept_url: `/mypage/?tab=org&invite=${encodeURIComponent(token)}`, status: "pending", created_at: ts };
}

export async function acceptOrganizationInvite(env: Env, userId: string, token: string) {
  const invite = await env.DB.prepare(
    "SELECT id, org_id, email, role, status FROM organization_invites WHERE token=?"
  ).bind(token).first<{ id: string; org_id: string; email: string; role: OrgRole; status: string }>();
  if (!invite) throw new OrgError(404, "초대를 찾을 수 없습니다.", "invite_not_found");
  if (invite.status !== "pending") throw new OrgError(409, "이미 처리된 초대입니다.", "invite_not_pending");

  const emails = await userEmails(env, userId);
  if (emails.length && !emails.includes(invite.email.toLowerCase())) {
    throw new OrgError(403, "초대 이메일과 로그인 계정이 일치하지 않습니다.", "invite_email_mismatch");
  }

  const ts = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO organization_members (org_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)
       ON CONFLICT(org_id, user_id) DO UPDATE SET
         role=excluded.role,
         status='active',
         updated_at=excluded.updated_at`
    ).bind(invite.org_id, userId, normalizeRole(invite.role), ts, ts),
    env.DB.prepare(
      "UPDATE organization_invites SET status='accepted', accepted_at=? WHERE id=?"
    ).bind(ts, invite.id),
  ]);
  await recordOrganizationAuditLog(env, {
    orgId: invite.org_id,
    actorUserId: userId,
    action: "org.invite_accepted",
    targetUserId: userId,
    metadata: { role: normalizeRole(invite.role) },
  });
  return { org_id: invite.org_id, role: normalizeRole(invite.role), accepted_at: ts };
}

async function activeAdminCount(env: Env, orgId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM organization_members WHERE org_id=? AND status='active' AND role='admin'"
  ).bind(orgId).first<{ count: number }>();
  return Number(row?.count) || 0;
}

export async function updateOrganizationMember(env: Env, userId: string, orgId: string, memberUserId: string, body: unknown) {
  await requireAdmin(env, userId, orgId);
  const rec = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const role = normalizeRole(rec.role);
  const current = await env.DB.prepare(
    "SELECT role FROM organization_members WHERE org_id=? AND user_id=? AND status='active'"
  ).bind(orgId, memberUserId).first<{ role: OrgRole }>();
  if (!current) throw new OrgError(404, "멤버를 찾을 수 없습니다.", "member_not_found");
  if (current.role === "admin" && role !== "admin" && (await activeAdminCount(env, orgId)) <= 1) {
    throw new OrgError(400, "마지막 관리자는 일반 멤버로 바꿀 수 없습니다.", "last_admin");
  }
  await env.DB.prepare(
    "UPDATE organization_members SET role=?, updated_at=? WHERE org_id=? AND user_id=?"
  ).bind(role, now(), orgId, memberUserId).run();
  await recordOrganizationAuditLog(env, {
    orgId,
    actorUserId: userId,
    action: "org.member_role_updated",
    targetUserId: memberUserId,
    metadata: { previous_role: current.role, next_role: role },
  });
  return { user_id: memberUserId, role, role_label: ROLE_LABEL[role] };
}

export async function removeOrganizationMember(env: Env, userId: string, orgId: string, memberUserId: string) {
  await requireAdmin(env, userId, orgId);
  if (userId === memberUserId) throw new OrgError(400, "본인 계정은 이 화면에서 제거할 수 없습니다.", "self_remove_forbidden");
  const org = await env.DB.prepare(
    "SELECT owner_user_id FROM organizations WHERE id=?"
  ).bind(orgId).first<{ owner_user_id: string }>();
  if (org?.owner_user_id === memberUserId) throw new OrgError(400, "조직 소유자는 제거할 수 없습니다.", "owner_remove_forbidden");
  const current = await env.DB.prepare(
    "SELECT role FROM organization_members WHERE org_id=? AND user_id=? AND status='active'"
  ).bind(orgId, memberUserId).first<{ role: OrgRole }>();
  if (!current) throw new OrgError(404, "멤버를 찾을 수 없습니다.", "member_not_found");
  if (current.role === "admin" && (await activeAdminCount(env, orgId)) <= 1) {
    throw new OrgError(400, "마지막 관리자는 제거할 수 없습니다.", "last_admin");
  }
  await env.DB.prepare(
    "UPDATE organization_members SET status='removed', updated_at=? WHERE org_id=? AND user_id=?"
  ).bind(now(), orgId, memberUserId).run();
  await recordOrganizationAuditLog(env, {
    orgId,
    actorUserId: userId,
    action: "org.member_removed",
    targetUserId: memberUserId,
    metadata: { previous_role: current.role },
  });
  return { ok: true };
}

async function periodBudget(env: Env, orgId: string, userId: string, role: OrgRole, days: number): Promise<number> {
  if (role !== "admin") {
    const settings = await getUsageLimitSettings(env, userId);
    return settings.daily_limit_krw * days;
  }
  const fallback = Number(env.DAILY_LIMIT_KRW || "500") || 500;
  const { results } = await env.DB.prepare(
    `SELECT COALESCE(l.daily_limit_krw, ?) AS daily_limit_krw
     FROM organization_members m
     LEFT JOIN usage_limits l ON l.user_id=m.user_id
     WHERE m.org_id=? AND m.status='active'`
  ).bind(fallback, orgId).all<{ daily_limit_krw: number }>();
  const daily = (results || []).reduce((sum, row) => sum + (Number(row.daily_limit_krw) || fallback), 0);
  return daily * days;
}

export async function getOrganizationUsage(env: Env, userId: string, orgId: string, periodValue?: string | null) {
  const role = await requireMember(env, userId, orgId);
  const period = normalizePeriod(periodValue);
  const dayCount = daysForPeriod(period);
  const { since, days } = dateRange(dayCount);
  const adminScope = role === "admin";
  const settings = await orgSettings(env, orgId);
  const revealIdentifiers = adminScope && settings.reveal_member_identifiers;
  const scopeWhere = adminScope
    ? "(org_id=? OR user_id IN (SELECT user_id FROM organization_members WHERE org_id=? AND status='active'))"
    : "user_id=?";
  const scopeBinds = adminScope ? [orgId, orgId] : [userId];

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cache_tokens),0) AS cache_tokens,
            COALESCE(SUM(cost_krw),0) AS cost_krw
     FROM usage_events WHERE ${scopeWhere} AND day>=?`
  ).bind(...scopeBinds, since).first<UsageTotalRow>();

  const { results: dayRows } = await env.DB.prepare(
    `SELECT day, COUNT(*) AS requests, COALESCE(SUM(cost_krw),0) AS cost
     FROM usage_events WHERE ${scopeWhere} AND day>=?
     GROUP BY day ORDER BY day`
  ).bind(...scopeBinds, since).all<{ day: string; requests: number; cost: number }>();

  const { results: providerRows } = await env.DB.prepare(
    `SELECT provider, COUNT(*) AS requests,
            COALESCE(SUM(input_tokens + output_tokens + cache_tokens),0) AS total_tokens,
            COALESCE(SUM(cost_krw),0) AS cost_krw
     FROM usage_events WHERE ${scopeWhere} AND day>=?
     GROUP BY provider ORDER BY cost_krw DESC`
  ).bind(...scopeBinds, since).all<{ provider: string; requests: number; total_tokens: number; cost_krw: number }>();

  const memberRows = await activeMemberRows(env, orgId, adminScope ? undefined : userId);
  const { results: usageRows } = await env.DB.prepare(
    `SELECT user_id, COUNT(*) AS requests,
            COALESCE(SUM(input_tokens + output_tokens + cache_tokens),0) AS total_tokens,
            COALESCE(SUM(cost_krw),0) AS cost_krw,
            MAX(created_at) AS latest_at
     FROM usage_events WHERE ${scopeWhere} AND day>=?
     GROUP BY user_id ORDER BY cost_krw DESC`
  ).bind(...scopeBinds, since).all<{ user_id: string; requests: number; total_tokens: number; cost_krw: number; latest_at: string | null }>();

  const deviceRows = adminScope ? (await env.DB.prepare(
    `SELECT COALESCE(device_id, CASE WHEN user_id LIKE 'anon:%' THEN substr(user_id, 6) ELSE '' END) AS device_key,
            user_id AS owner_user_id,
            COUNT(*) AS requests,
            COALESCE(SUM(input_tokens + output_tokens + cache_tokens),0) AS total_tokens,
            COALESCE(SUM(cost_krw),0) AS cost_krw,
            MAX(created_at) AS latest_at
     FROM usage_events
     WHERE ${scopeWhere} AND day>=? AND (device_id IS NOT NULL OR user_id LIKE 'anon:%')
     GROUP BY device_key, owner_user_id
     HAVING device_key <> ''
     ORDER BY cost_krw DESC
     LIMIT 100`
  ).bind(...scopeBinds, since).all<OrgDeviceUsageRow>()).results || [] : [];

  const usageByUser = new Map((usageRows || []).map((row) => [row.user_id, row]));
  const daily: Record<string, { cost: number; requests: number }> = {};
  for (const day of days) daily[day] = { cost: 0, requests: 0 };
  for (const row of dayRows || []) {
    if (!daily[row.day]) continue;
    daily[row.day].cost = Number(row.cost) || 0;
    daily[row.day].requests = Number(row.requests) || 0;
  }

  const input = Number(totalRow?.input_tokens) || 0;
  const output = Number(totalRow?.output_tokens) || 0;
  const cache = Number(totalRow?.cache_tokens) || 0;
  const cost = Number(totalRow?.cost_krw) || 0;
  const budget = await periodBudget(env, orgId, userId, role, dayCount);

  return {
    org_id: orgId,
    period,
    scope: adminScope ? "organization" : "self",
    role,
    settings: adminScope ? settings : null,
    since,
    days: dayCount,
    totals: {
      requests: Number(totalRow?.requests) || 0,
      input_tokens: input,
      output_tokens: output,
      cache_tokens: cache,
      total_tokens: input + output + cache,
      cost_krw: cost,
    },
    budget: {
      period_limit_krw: budget,
      used_krw: cost,
      remaining_krw: Math.max(0, budget - cost),
      burn_rate: budget > 0 ? cost / budget : 0,
    },
    days_series: days.map((day) => ({ day, cost: daily[day].cost, requests: daily[day].requests })),
    providers: (providerRows || []).map((row) => ({
      provider: row.provider,
      requests: Number(row.requests) || 0,
      total_tokens: Number(row.total_tokens) || 0,
      cost_krw: Number(row.cost_krw) || 0,
    })),
    members: memberRows.map((member) => {
      const usage = usageByUser.get(member.user_id);
      return {
        ...memberForApi(member, adminScope, revealIdentifiers),
        requests: Number(usage?.requests) || 0,
        total_tokens: Number(usage?.total_tokens) || 0,
        cost_krw: Number(usage?.cost_krw) || 0,
        latest_at: usage?.latest_at || null,
      };
    }),
    devices: deviceRows.map((row) => ({
      device_id_masked: maskUsageIdentifier(row.device_key, 4),
      device_id_raw: revealIdentifiers ? row.device_key : null,
      label: `Device ${maskUsageIdentifier(row.device_key, 4)}`,
      owner_label: row.owner_user_id?.startsWith("anon:")
        ? `Anonymous device ${maskUsageIdentifier(row.owner_user_id, 4)}`
        : `Account ${maskUsageIdentifier(row.owner_user_id, 4)}`,
      owner_identifier_raw: revealIdentifiers ? row.owner_user_id : null,
      requests: Number(row.requests) || 0,
      total_tokens: Number(row.total_tokens) || 0,
      cost_krw: Number(row.cost_krw) || 0,
      latest_at: row.latest_at || null,
    })),
  };
}

export async function saveOrganizationSettings(env: Env, userId: string, orgId: string, body: unknown) {
  await requireAdmin(env, userId, orgId);
  const previous = await orgSettings(env, orgId);
  const next = normalizeOrgSettings(body, previous);
  const ts = now();
  await env.DB.prepare(
    `UPDATE organizations
     SET reveal_member_identifiers=?,
         allow_raw_usage_export=?,
         admin_overage_email_enabled=?,
         audit_log_retention_days=?,
         updated_at=?
     WHERE id=?`
  ).bind(
    next.reveal_member_identifiers ? 1 : 0,
    next.allow_raw_usage_export ? 1 : 0,
    next.admin_overage_email_enabled ? 1 : 0,
    next.audit_log_retention_days,
    ts,
    orgId
  ).run();
  await recordOrganizationAuditLog(env, {
    orgId,
    actorUserId: userId,
    action: "org.settings_updated",
    metadata: { previous, next },
  });
  return next;
}

export async function getOrganizationAuditLogs(env: Env, userId: string, orgId: string) {
  await requireAdmin(env, userId, orgId);
  const settings = await orgSettings(env, orgId);
  const logs = await listOrganizationAuditLogs(env, orgId, settings.audit_log_retention_days, 100);
  return { logs, retention_days: settings.audit_log_retention_days };
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function getOrganizationUsageExportCsv(env: Env, userId: string, orgId: string, periodValue?: string | null, includeRawIdentifiers = false) {
  const role = await requireMember(env, userId, orgId);
  if (role !== "admin") throw new OrgError(403, "Organization admin permission is required for usage export.", "org_admin_required");
  const settings = await orgSettings(env, orgId);
  const includeRaw = includeRawIdentifiers && settings.allow_raw_usage_export;
  if (includeRawIdentifiers && !settings.allow_raw_usage_export) {
    throw new OrgError(403, "Raw identifier export is disabled for this organization.", "raw_export_disabled");
  }
  const period = normalizePeriod(periodValue);
  const dayCount = Math.min(USAGE_RETENTION_DAYS, daysForPeriod(period));
  const since = new Date(Date.now() - (dayCount - 1) * 86400000).toISOString().slice(0, 10);
  const scopeWhere = "(org_id=? OR user_id IN (SELECT user_id FROM organization_members WHERE org_id=? AND status='active'))";
  const { results } = await env.DB.prepare(
    `SELECT day, created_at, user_id, device_id,
            COALESCE((SELECT email FROM user_identities ui
              WHERE ui.user_id=usage_events.user_id AND ui.email IS NOT NULL AND ui.email<>''
              ORDER BY ui.provider='email' DESC, ui.updated_at DESC
              LIMIT 1), user_id) AS account_identifier_raw,
            provider, model, input_tokens, output_tokens, cache_tokens,
            cost_krw, source, status_code
     FROM usage_events
     WHERE ${scopeWhere} AND day>=?
     ORDER BY created_at DESC`
  ).bind(orgId, orgId, since).all<{
    day: string;
    created_at: string;
    user_id: string;
    device_id: string | null;
    account_identifier_raw: string;
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_tokens: number;
    cost_krw: number;
    source: string;
    status_code: number | null;
  }>();
  const header = [
    "day",
    "created_at",
    "account_label",
    "device_label",
    ...(includeRaw ? ["account_identifier_raw", "device_id_raw"] : []),
    "provider",
    "model",
    "input_tokens",
    "output_tokens",
    "cache_tokens",
    "total_tokens",
    "cost_krw",
    "source",
    "status_code",
  ];
  const rows = (results || []).map((row) => {
      const input = Number(row.input_tokens) || 0;
      const output = Number(row.output_tokens) || 0;
      const cache = Number(row.cache_tokens) || 0;
      const cells = [
        row.day,
        row.created_at,
        row.user_id?.startsWith("anon:") ? `Anonymous device ${maskUsageIdentifier(row.user_id, 4)}` : `Account ${maskUsageIdentifier(row.user_id, 4)}`,
        row.device_id ? `Device ${maskUsageIdentifier(row.device_id, 4)}` : "",
        ...(includeRaw ? [row.account_identifier_raw || row.user_id, row.device_id || ""] : []),
        row.provider,
        row.model,
        input,
        output,
        cache,
        input + output + cache,
        Number(row.cost_krw) || 0,
        row.source || "app",
        row.status_code ?? "",
      ];
      return cells;
    });
  const csv = [header.join(","), ...rows.map((cells) => cells.map(csvCell).join(","))].join("\n");
  await recordOrganizationAuditLog(env, {
    orgId,
    actorUserId: userId,
    action: includeRaw ? "org.usage_xlsx_exported_raw" : "org.usage_xlsx_exported_masked",
    metadata: { period, since, rows: (results || []).length, include_raw_identifiers: includeRaw },
  });
  return {
    filename: `org-${orgId}-usage-${since}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    csv,
    header,
    rows,
  };
}
