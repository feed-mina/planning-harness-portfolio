import type { Env } from "../../env";
import { escapeHtml } from "../../html";
import { sendTransactionalEmail } from "../../mail";
import { recordOrganizationAuditLog } from "./orgAudit";

type AlertKind = "warning" | "limit";

interface OrgAdminAlertRow {
  org_id: string;
  org_name: string;
  admin_user_id: string;
  email: string;
}

function maskIdentifier(value: string | null | undefined, visible = 4): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("@")) {
    const [local, domain] = raw.split("@");
    return `${local.slice(0, 2)}***@${domain || "***"}`;
  }
  const compact = raw.replace(/^anon:/, "");
  if (compact.length <= visible * 2) return `${compact.slice(0, 2)}***`;
  return `${compact.slice(0, visible)}...${compact.slice(-visible)}`;
}

async function userAllowsBudgetAlerts(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT alert_email_enabled FROM usage_limits WHERE user_id=?"
  ).bind(userId).first<{ alert_email_enabled: number }>();
  return row?.alert_email_enabled !== 0;
}

export async function sendOrganizationOverageAdminEmails(
  env: Env,
  memberUserId: string,
  day: string,
  kind: AlertKind,
  threshold: number,
  used: number
): Promise<void> {
  if (!(await userAllowsBudgetAlerts(env, memberUserId))) return;
  if (!env.SENDGRID_API_KEY || !env.ALERT_EMAIL_FROM) return;

  const { results } = await env.DB.prepare(
    `SELECT o.id AS org_id,
            o.name AS org_name,
            m_admin.user_id AS admin_user_id,
            ui.email AS email
     FROM organization_members m_member
     JOIN organizations o ON o.id=m_member.org_id
     JOIN organization_members m_admin
       ON m_admin.org_id=o.id
      AND m_admin.status='active'
      AND m_admin.role='admin'
     JOIN user_identities ui
       ON ui.user_id=m_admin.user_id
      AND ui.email IS NOT NULL
      AND ui.email<>''
     WHERE m_member.user_id=?
       AND m_member.status='active'
       AND o.admin_overage_email_enabled=1
     GROUP BY o.id, m_admin.user_id, ui.email`
  ).bind(memberUserId).all<OrgAdminAlertRow>();

  const rows = results || [];
  if (!rows.length) return;

  const usedText = Math.round(used).toLocaleString("ko-KR");
  const thresholdText = Math.round(threshold).toLocaleString("ko-KR");
  const memberLabel = maskIdentifier(memberUserId, 4);
  const label = kind === "limit" ? "member budget limit reached" : "member budget warning";

  for (const row of rows) {
    const text = [
      `Organization: ${row.org_name}`,
      `Alert: ${label}`,
      `Day: ${day}`,
      `Member: ${memberLabel}`,
      `Used: ${usedText} KRW`,
      `Threshold: ${thresholdText} KRW`,
      "",
      "This email is sent only when the organization admin alert setting is enabled and the member allows budget emails.",
    ].join("\n");
    const html = `<h1>${escapeHtml(row.org_name)}: ${label}</h1><p>Day: ${escapeHtml(day)}</p><p>Member: ${escapeHtml(memberLabel)}</p><p>Used: <strong>${escapeHtml(usedText)} KRW</strong></p><p>Threshold: ${escapeHtml(thresholdText)} KRW</p><p>This email follows the member budget email preference.</p>`;
    try {
      await sendTransactionalEmail(env, row.email, `[Planning Harness] ${row.org_name} ${label}`, text, html, [
        "planning-harness",
        "org-budget-alert",
      ]);
      await recordOrganizationAuditLog(env, {
        orgId: row.org_id,
        actorUserId: "system",
        action: "org.admin_overage_email_sent",
        targetUserId: memberUserId,
        metadata: { kind, day, threshold_krw: threshold, used_krw: used, recipient_admin_user_id: row.admin_user_id },
      });
    } catch (err: any) {
      await recordOrganizationAuditLog(env, {
        orgId: row.org_id,
        actorUserId: "system",
        action: "org.admin_overage_email_failed",
        targetUserId: memberUserId,
        metadata: { kind, day, error: String(err?.message || "email_send_failed").slice(0, 500) },
      });
    }
  }
}
