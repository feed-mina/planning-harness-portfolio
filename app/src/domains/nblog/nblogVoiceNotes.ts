import type { NBlogEnv } from "./nblog";

/**
 * 음성메모 → 전사 → 생성 근거 (#186).
 *
 * 사진에 없는 것(맛, 서비스, 대기시간, 동행 반응)은 지어낼 수 없다. 사용자가 직접 말한
 * 내용이 들어오면 그 범위에서 서술할 수 있게 된다.
 */

/** Workers 요청 한도와 전사 비용을 함께 고려한 상한. 방문 메모 길이면 충분하다. */
export const MAX_VOICE_BYTES = 25 * 1024 * 1024;
export const MAX_TRANSCRIPT_CHARS = 8_000;

const ALLOWED_CONTENT_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/flac",
]);

export type VoiceNote = {
  note_id: string;
  original_name: string;
  transcript: string;
  transcript_status: "pending" | "ready" | "failed";
  transcript_error: string | null;
  edited: number;
  created_at: string;
};

export function isAllowedAudioType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(contentType.split(";")[0].trim().toLowerCase());
}

/**
 * 전사 텍스트는 사용자 자유 입력이므로 프롬프트 인젝션 검사 대상이다. 지시문처럼 보이는
 * 줄은 근거에서 제외한다 — 모델에게 명령하는 문장이 근거로 들어가면 안 된다.
 */
const INJECTION_PATTERN = /(?:\b(?:system|developer|assistant)\s+prompt\b|ignore\s+(?:all\s+)?previous\s+instructions|<\|(?:system|assistant|user)\|>|이전\s*(?:지시|규칙).*무시|시스템\s*(?:지시|규칙))/i;

export function sanitizeTranscript(raw: string): { text: string; removed: number } {
  const lines = String(raw || "").split("\n");
  const kept = lines.filter((line) => !INJECTION_PATTERN.test(line));
  return {
    text: kept.join("\n").trim().slice(0, MAX_TRANSCRIPT_CHARS),
    removed: lines.length - kept.length,
  };
}

/**
 * OpenAI 전사 API 호출. 저장소에 Clova 연동(clovaRecordings.ts)이 있지만 staging 에
 * CLOVA 시크릿이 없고, OPENAI_API_KEY 는 이미 동작 중이라 그쪽을 쓴다.
 */
export async function transcribeAudio(
  env: NBlogEnv,
  bytes: ArrayBuffer,
  fileName: string,
  contentType: string,
): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), fileName);
  form.append("model", env.NBLOG_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  form.append("response_format", "text");
  // 상호명·메뉴명이 한국어라 언어를 고정해 오인식을 줄인다.
  form.append("language", "ko");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!response.ok) throw new Error(`transcribe ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.text()).trim();
}

export async function listVoiceNotes(env: NBlogEnv, userId: string, campaignId: string): Promise<VoiceNote[]> {
  const result = await env.DB.prepare(
    `SELECT note_id, original_name, transcript, transcript_status, transcript_error, edited, created_at
     FROM nblog_voice_notes WHERE user_id=?1 AND campaign_id=?2 ORDER BY created_at`
  ).bind(userId, campaignId).all<VoiceNote>();
  return result.results || [];
}

/** 프롬프트에 넣을 근거 블록. 전사에 실패했거나 비어 있으면 제외한다. */
export function voiceNotesForPrompt(notes: VoiceNote[]): string {
  const usable = notes
    .filter((note) => note.transcript_status === "ready" && note.transcript.trim())
    .map((note) => sanitizeTranscript(note.transcript).text)
    .filter(Boolean);
  return usable.join("\n\n");
}
