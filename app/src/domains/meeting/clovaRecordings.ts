import type { Env } from "../../env";
import { transcribeClovaForm, SttError, type SttResult } from "../../stt";

const MAX_TRANSCRIPT_CHARS = 250_000;
const MAX_TITLE_CHARS = 180;
const TEXT_EXT = /\.(txt|md|srt|vtt)$/i;

type TranscriptStatus = "ready" | "needs_transcript" | "transcribing" | "failed";

interface ClovaRecordingRow {
  id: string;
  user_id: string;
  external_recording_id: string | null;
  title: string;
  recorded_at: string | null;
  duration_sec: number | null;
  transcript_text: string | null;
  transcript_status: TranscriptStatus;
  source_provider: string;
  imported_at: string;
  updated_at: string;
}

interface NormalizedRecordingInput {
  externalRecordingId: string | null;
  title: string;
  recordedAt: string | null;
  durationSec: number | null;
  transcriptText: string | null;
  transcriptStatus: TranscriptStatus;
  sourceProvider: string;
}

export class ClovaRecordingError extends Error {
  constructor(public status: number, message: string, public code = "clova_recording_error") {
    super(message);
    this.name = "ClovaRecordingError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formValue(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" ? value : null;
}

function formEntry(form: FormData, key: string): unknown {
  return (form as { get(name: string): unknown }).get(key);
}

function cleanString(value: unknown, max: number): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function cleanTranscript(value: unknown): string | null {
  return cleanString(value, MAX_TRANSCRIPT_CHARS);
}

function cleanRecordedAt(value: unknown): string | null {
  const raw = cleanString(value, 40);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function cleanDuration(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function recordingTitle(value: unknown, fallback = "Clova recording"): string {
  return cleanString(value, MAX_TITLE_CHARS) || fallback;
}

function statusForTranscript(text: string | null, explicit?: unknown): TranscriptStatus {
  const raw = cleanString(explicit, 40);
  if (raw === "ready" || raw === "needs_transcript" || raw === "transcribing" || raw === "failed") return raw;
  return text ? "ready" : "needs_transcript";
}

function rowToApi(row: ClovaRecordingRow) {
  const transcript = row.transcript_text || "";
  return {
    id: row.id,
    external_recording_id: row.external_recording_id,
    title: row.title,
    recorded_at: row.recorded_at,
    duration_sec: row.duration_sec,
    transcript_text: transcript,
    transcript_preview: transcript.slice(0, 240),
    transcript_status: row.transcript_status,
    source_provider: row.source_provider,
    imported_at: row.imported_at,
    updated_at: row.updated_at,
  };
}

function inputFromJson(body: unknown): NormalizedRecordingInput {
  const rec = asRecord(body);
  const transcriptText = cleanTranscript(rec.transcript_text ?? rec.transcript ?? rec.text);
  return {
    externalRecordingId: cleanString(rec.external_recording_id ?? rec.externalRecordingId, 120),
    title: recordingTitle(rec.title, "Clova recording"),
    recordedAt: cleanRecordedAt(rec.recorded_at ?? rec.recordedAt),
    durationSec: cleanDuration(rec.duration_sec ?? rec.durationSec),
    transcriptText,
    transcriptStatus: statusForTranscript(transcriptText, rec.transcript_status ?? rec.transcriptStatus),
    sourceProvider: cleanString(rec.source_provider ?? rec.sourceProvider, 40) || "clova",
  };
}

async function textFromMultipartFile(file: File): Promise<string | null> {
  if (!TEXT_EXT.test(file.name || "") && !(file.type || "").startsWith("text/")) return null;
  return cleanTranscript(await file.text());
}

async function inputFromForm(env: Env, form: FormData): Promise<NormalizedRecordingInput> {
  const media = formEntry(form, "media");
  let transcriptText = cleanTranscript(formValue(form, "transcript_text") ?? formValue(form, "transcript"));
  let sttResult: SttResult | null = null;

  if (!transcriptText && media instanceof File) {
    transcriptText = await textFromMultipartFile(media);
    if (!transcriptText) {
      sttResult = await transcribeClovaForm(env, form);
      transcriptText = cleanTranscript(sttResult.text);
    }
  }

  return {
    externalRecordingId: cleanString(formValue(form, "external_recording_id"), 120),
    title: recordingTitle(formValue(form, "title"), media instanceof File ? media.name : "Clova recording"),
    recordedAt: cleanRecordedAt(formValue(form, "recorded_at")),
    durationSec: cleanDuration(formValue(form, "duration_sec")),
    transcriptText,
    transcriptStatus: statusForTranscript(transcriptText, formValue(form, "transcript_status")),
    sourceProvider: sttResult?.provider || cleanString(formValue(form, "source_provider"), 40) || "clova",
  };
}

async function existingIdForExternal(env: Env, userId: string, externalRecordingId: string | null): Promise<string | null> {
  if (!externalRecordingId) return null;
  const row = await env.DB.prepare(
    "SELECT id FROM clova_recordings WHERE user_id=? AND external_recording_id=?"
  ).bind(userId, externalRecordingId).first<{ id: string }>();
  return row?.id || null;
}

export async function listClovaRecordings(env: Env, userId: string, limitValue?: number) {
  const limit = Math.min(50, Math.max(1, Number(limitValue) || 20));
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, external_recording_id, title, recorded_at, duration_sec,
            transcript_text, transcript_status, source_provider, imported_at, updated_at
     FROM clova_recordings
     WHERE user_id=?
     ORDER BY COALESCE(recorded_at, updated_at) DESC, updated_at DESC
     LIMIT ?`
  ).bind(userId, limit).all<ClovaRecordingRow>();
  return { recordings: (results || []).map(rowToApi) };
}

export async function getClovaRecording(env: Env, userId: string, id: string) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, external_recording_id, title, recorded_at, duration_sec,
            transcript_text, transcript_status, source_provider, imported_at, updated_at
     FROM clova_recordings
     WHERE id=? AND user_id=?`
  ).bind(id, userId).first<ClovaRecordingRow>();
  if (!row) throw new ClovaRecordingError(404, "Clova recording not found.", "not_found");
  return rowToApi(row);
}

export async function importClovaRecording(env: Env, userId: string, request: Request) {
  const contentType = request.headers.get("content-type") || "";
  let input: NormalizedRecordingInput;
  try {
    if (contentType.includes("multipart/form-data")) {
      input = await inputFromForm(env, await request.formData());
    } else {
      input = inputFromJson(await request.json().catch(() => ({})));
    }
  } catch (err) {
    if (err instanceof SttError) throw err;
    throw err;
  }

  const now = new Date().toISOString();
  const id = await existingIdForExternal(env, userId, input.externalRecordingId) || crypto.randomUUID();
  const importedAt = now;
  await env.DB.prepare(
    `INSERT INTO clova_recordings (
       id, user_id, external_recording_id, title, recorded_at, duration_sec,
       transcript_text, transcript_status, source_provider, imported_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, external_recording_id) DO UPDATE SET
       title=excluded.title,
       recorded_at=excluded.recorded_at,
       duration_sec=excluded.duration_sec,
       transcript_text=excluded.transcript_text,
       transcript_status=excluded.transcript_status,
       source_provider=excluded.source_provider,
       updated_at=excluded.updated_at`
  ).bind(
    id,
    userId,
    input.externalRecordingId,
    input.title,
    input.recordedAt,
    input.durationSec,
    input.transcriptText,
    input.transcriptStatus,
    input.sourceProvider,
    importedAt,
    now
  ).run();

  return { ok: true, recording: await getClovaRecording(env, userId, id) };
}

export async function meetingInputFromClovaRecording(env: Env, userId: string, body: unknown) {
  const rec = asRecord(body);
  const id = cleanString(rec.recording_id ?? rec.id, 120);
  if (!id) throw new ClovaRecordingError(400, "recording_id is required.", "missing_recording_id");
  const recording = await getClovaRecording(env, userId, id);
  if (!recording.transcript_text) {
    throw new ClovaRecordingError(409, "Recording transcript is not ready.", "transcript_not_ready");
  }
  return {
    ok: true,
    meeting_source: {
      kind: "clova_recording",
      recording_id: recording.id,
      source_provider: recording.source_provider,
    },
    recording,
    transcript: recording.transcript_text,
    subject: recording.title,
    date: recording.recorded_at ? String(recording.recorded_at).slice(0, 10) : null,
  };
}
