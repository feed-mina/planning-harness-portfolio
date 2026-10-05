import type { Env } from "../../env";

export interface OrganizationAuditLogInput {
  orgId: string;
  actorUserId: string;
  action: string;
  targetUserId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface OrganizationAuditLog {
  id: number;
  org_id: string;
  actor_user_id: string;
  action: string;
  target_user_id: string | null;
  metadata_json: string | null;
  created_at: string;
}

function metadataJson(value?: Record<string, unknown> | null): string | null {
  if (!value) return null;
  try {
    return JSON.stringify(value).slice(0, 4000);
  } catch {
    return null;
  }
}

export async function recordOrganizationAuditLog(env: Env, input: OrganizationAuditLogInput): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO organization_audit_logs
       (org_id, actor_user_id, action, target_user_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    input.orgId,
    input.actorUserId,
    input.action.slice(0, 120),
    input.targetUserId || null,
    metadataJson(input.metadata),
    new Date().toISOString()
  ).run();
}

export async function listOrganizationAuditLogs(
  env: Env,
  orgId: string,
  retentionDays: number,
  limit = 100
): Promise<OrganizationAuditLog[]> {
  const safeRetention = Math.min(365, Math.max(30, Math.round(Number(retentionDays) || 90)));
  const cutoff = new Date(Date.now() - safeRetention * 86400000).toISOString();
  await env.DB.prepare(
    "DELETE FROM organization_audit_logs WHERE org_id=? AND created_at<?"
  ).bind(orgId, cutoff).run();

  const { results } = await env.DB.prepare(
    `SELECT id, org_id, actor_user_id, action, target_user_id, metadata_json, created_at
     FROM organization_audit_logs
     WHERE org_id=?
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(orgId, Math.min(200, Math.max(1, Math.round(Number(limit) || 100)))).all<OrganizationAuditLog>();
  return results || [];
}
