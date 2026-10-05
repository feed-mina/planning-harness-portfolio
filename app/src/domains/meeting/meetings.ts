// M3 회의록 저장/이력 — 본문 .md 는 R2, 메타는 D1(meetings). 로그인 사용자만.
import type { Env } from "../../env";

export interface MeetingMetaRow { id: string; title: string; date: string | null; r2_key: string; created_at: string; }

// 생성된 회의록을 R2 에 저장하고 D1 에 메타 기록. 키: meetings/<userId>/<id>.md
export async function saveMeeting(
  env: Env, userId: string, m: { title: string; date?: string; markdown: string; dagshubRunUrl?: string | null }
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const key = `meetings/${userId}/${id}.md`;
  await env.R2.put(key, m.markdown, { httpMetadata: { contentType: "text/markdown; charset=utf-8" } });
  await env.DB.prepare(
    `INSERT INTO meetings (id, user_id, title, date, r2_key, dagshub_run_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, (m.title || "회의록").slice(0, 200), m.date || null, key, m.dagshubRunUrl || null, new Date().toISOString()).run();
  return { id };
}

// 내 회의록 목록(메타만). 최신순. clamp 는 Garden·자료 픽커의 limit=200 요청과 맞춘다.
export async function listMeetings(env: Env, userId: string, limit = 20) {
  const n = Math.min(200, Math.max(1, limit));
  const { results } = await env.DB.prepare(
    `SELECT id, title, date, created_at FROM meetings WHERE user_id=? ORDER BY created_at DESC LIMIT ?`
  ).bind(userId, n).all<{ id: string; title: string; date: string | null; created_at: string }>();
  return results || [];
}

// 단일 회의록(본문 포함) — 소유자 확인 후 R2 에서 본문 로드. 재다운로드용.
export async function getMeeting(env: Env, userId: string, id: string) {
  const row = await env.DB.prepare(
    `SELECT id, title, date, r2_key, created_at FROM meetings WHERE id=? AND user_id=?`
  ).bind(id, userId).first<MeetingMetaRow>();
  if (!row) return null;
  const obj = await env.R2.get(row.r2_key);
  const markdown = obj ? await obj.text() : "";
  return { id: row.id, title: row.title, date: row.date, created_at: row.created_at, markdown };
}
