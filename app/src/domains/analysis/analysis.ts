import { generateText, type AISettings, type GenerateTextResult } from "../../ai";
import { checkQuota, logUsage, type QuotaState } from "../usage";
import type { Env } from "../../env";
import { deleteFileChunks, deleteSessionChunks, formatRetrievedContext, retrieveRelevantChunks, syncFileChunks, type RetrievedChunk } from "./rag";
import { deleteFileGraph, deleteSessionGraph, retrieveGraphChunks, syncFileGraph } from "./graph";
import { logDagsHubRun, usageExperiment } from "../../dagshub";
import type { AnalysisIndexJob } from "./analysisQueue";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_FILES_PER_SESSION = 15;
const MAX_TEXT_CHARS_PER_FILE = 12000;
const MAX_CONTEXT_CHARS = 52000;
const SEARCH_MODEL_BY_PROVIDER: Record<AISettings["provider"], string> = {
  gemini: "gemini-2.5-pro",
  claude: "claude-sonnet-4-6",
  openai: "gpt-5",
};

const TEXT_EXT_RE = /\.(txt|md|csv|tsv|json|jsonl|vtt|srt|log|xml|html|css|js|ts|tsx|jsx|py|sql)$/i;

export class AnalysisError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

export interface AnalysisSessionInput {
  title?: string | null;
  date?: string | null;
  subject?: string | null;
  meetingMarkdown?: string | null;
  etcUrl?: string | null;
  etcNote?: string | null;
}

interface AnalysisSessionRow {
  id: string;
  user_id: string;
  title: string | null;
  date: string | null;
  subject: string | null;
  meeting_r2_key: string | null;
  etc_url: string | null;
  etc_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisFileRow {
  id: string;
  session_id: string;
  user_id?: string;
  name: string;
  type: string | null;
  size: number;
  r2_key: string;
  text_excerpt: string | null;
  index_status: "pending" | "indexing" | "done" | "failed";
  index_error: string | null;
  index_attempts: number;
  index_run_id: string | null;
  index_updated_at: string | null;
  indexed_at: string | null;
  created_at: string;
}

interface AnalysisSummaryItem {
  file_id: string;
  name: string;
  summary: string;
  key_points: string[];
  sources?: string[];
}

interface AnalysisQuestion {
  id: string;
  question: string;
  options: string[];
  rationale?: string;
}

interface AnalysisPlanItem {
  id: string;
  title: string;
  detail: string;
  checked: boolean;
  result_contract?: Record<string, unknown> | null;
}

interface AnalysisManualStep {
  title: string;
  actions: string[];
  screenshot_caption?: string;
  warning?: string;
}

interface AnalysisManualPayload {
  doc_type: "manual" | "memo";
  title: string;
  purpose: string;
  audience?: string;
  prerequisites: string[];
  steps: AnalysisManualStep[];
  checklist: string[];
  faq: { q: string; a: string }[];
  note?: string;
}

interface AnalysisOutputRow {
  kind: string;
  content_json: string;
  provider: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

interface MeteredText {
  out: GenerateTextResult;
  cost: number;
  usedBefore: number;
  quota: QuotaState;
  latencyMs: number;
}

function cleanOptional(value: string | null | undefined, max = 1000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function safeUserKey(userId: string): string {
  return userId.replace(/[^\w.-]/g, "_").slice(0, 120);
}

function safeName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "analysis-file").slice(0, 160);
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isLikelyText(name: string, type: string): boolean {
  const mime = type.toLowerCase();
  // OOXML(xlsx/docx/pptx) 등은 MIME에 "openxmlformats" 가 들어가 느슨한 xml 매칭에 걸리므로 먼저 제외한다.
  if (/officedocument|opendocument|ms-excel|ms-powerpoint|msword|application\/zip|octet-stream|pdf/.test(mime)) return false;
  return mime.startsWith("text/") || /\b(json|csv|xml|javascript|typescript|yaml|markdown)\b/.test(mime) || TEXT_EXT_RE.test(name);
}

function textExtractReason(name: string, type: string | null, textExcerpt: string | null): string | null {
  if (textExcerpt) return null;
  const mime = type || "";
  if (/\.pdf$/i.test(name) || /pdf/i.test(mime)) return "PDF에서 텍스트를 추출하지 못했습니다(스캔 이미지이거나 파싱 실패). 파일명·메모만 참고됩니다.";
  if (/\.(xlsx|xls)$/i.test(name) || /spreadsheet|excel/i.test(mime))
    return "엑셀에서 텍스트를 추출하지 못했습니다(파싱 실패). 파일명·메모만 참고됩니다.";
  if (isLikelyText(name, mime)) return "텍스트 파일이 비어 있거나 UTF-8로 읽을 수 있는 본문이 없습니다.";
  return "이 파일 형식은 서버 텍스트 발췌 대상이 아닙니다.";
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean).slice(0, max);
}

function extractJson(text: string): unknown {
  let raw = text.trim();
  const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  return JSON.parse(raw);
}

function trimContext(text: string, max = MAX_CONTEXT_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n[이후 내용은 길이 제한으로 생략]";
}

function summarizeFallback(raw: string, files: AnalysisFileRow[]): { summaries: AnalysisSummaryItem[]; overall: string } {
  const lines = raw.split(/\r?\n/).map((line) => line.replace(/^[-*#\d.\s]+/, "").trim()).filter(Boolean);
  const first = lines.slice(0, 3).join(" ");
  if (!files.length) {
    return {
      summaries: [{
        file_id: "retriever-search",
        name: "리트리버 검색",
        summary: first || raw.slice(0, 900) || "검색형 분석 응답을 구조화하지 못했습니다. 원문 응답을 확인해 주세요.",
        key_points: lines.slice(0, 6),
      }],
      overall: first || raw.slice(0, 600),
    };
  }
  return {
    summaries: files.map((file, index) => ({
      file_id: file.id,
      name: file.name,
      summary: lines[index] || first || "AI 응답을 구조화하지 못했습니다. 원문 응답을 확인해 주세요.",
      key_points: lines.slice(0, 4),
    })),
    overall: first || raw.slice(0, 400),
  };
}

function normalizeSummaryPayload(parsed: unknown, raw: string, files: AnalysisFileRow[]) {
  const obj = asRecord(parsed);
  const arr = Array.isArray(obj?.summaries) ? obj.summaries : [];
  const summaries: AnalysisSummaryItem[] = [];
  arr.forEach((item, index) => {
    const rec = asRecord(item);
    if (!rec) return;
    const fallbackFile = files[index];
    const fileId = asString(rec.file_id) || asString(rec.fileId) || fallbackFile?.id || "";
    const known = files.find((file) => file.id === fileId) || fallbackFile;
    const summary = asString(rec.summary) || asString(rec.text);
    if (!summary) return;
    summaries.push({
      file_id: known?.id || fileId,
      name: asString(rec.name) || known?.name || "분석파일",
      summary: summary.slice(0, 900),
      key_points: stringArray(rec.key_points || rec.keyPoints || rec.points, 6).map((point) => point.slice(0, 240)),
      sources: stringArray(rec.sources || rec.source_chunks || rec.sourceChunks, 8).map((source) => source.slice(0, 180)),
    });
  });

  if (!summaries.length) return summarizeFallback(raw, files);
  const overall = asString(obj?.overall) || asString(obj?.summary) || summaries.map((item) => item.summary).join(" ").slice(0, 600);
  return { summaries, overall };
}

function publicSession(session: AnalysisSessionRow, meetingMarkdown?: string) {
  return {
    id: session.id,
    title: session.title,
    date: session.date,
    subject: session.subject,
    meeting_available: !!session.meeting_r2_key,
    meeting_markdown: meetingMarkdown,
    etc_url: session.etc_url,
    etc_note: session.etc_note,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };
}

function publicFile(file: AnalysisFileRow) {
  return {
    id: file.id,
    name: file.name,
    type: file.type,
    size: file.size,
    text_available: !!file.text_excerpt,
    text_extract_reason: textExtractReason(file.name, file.type, file.text_excerpt),
    index_status: file.index_status,
    index_error: file.index_error,
    index_attempts: file.index_attempts,
    index_updated_at: file.index_updated_at,
    indexed_at: file.indexed_at,
    created_at: file.created_at,
  };
}

function parseOutputRow(row: AnalysisOutputRow) {
  let content: Record<string, unknown> = {};
  try {
    content = asRecord(JSON.parse(row.content_json)) || {};
  } catch {
    content = {};
  }
  return {
    kind: row.kind,
    content,
    provider: row.provider,
    model: row.model,
    usage: { input_tokens: row.input_tokens, output_tokens: row.output_tokens },
    created_at: row.created_at,
  };
}

function normalizeQuestionsPayload(parsed: unknown, raw: string): { questions: AnalysisQuestion[] } {
  const obj = asRecord(parsed);
  const arr = Array.isArray(obj?.questions) ? obj.questions : [];
  const questions: AnalysisQuestion[] = [];
  arr.forEach((item, index) => {
    const rec = asRecord(item);
    if (!rec) return;
    const question = asString(rec.question) || asString(rec.q);
    const options = stringArray(rec.options || rec.opts || rec.choices, 4).map((option) => option.slice(0, 120));
    if (!question || options.length < 2) return;
    questions.push({
      id: asString(rec.id) || `q${index + 1}`,
      question: question.slice(0, 220),
      options: options.slice(0, 4),
      rationale: asString(rec.rationale).slice(0, 260) || undefined,
    });
  });
  if (questions.length) return { questions: questions.slice(0, 4) };

  const hints = raw.split(/\r?\n/).map((line) => line.replace(/^[-*#\d.\s]+/, "").trim()).filter(Boolean);
  return {
    questions: [
      { id: "q1", question: hints[0] || "이번 분석에서 가장 먼저 검증할 관점은 무엇인가요?", options: ["사용자/고객 관점", "비용/수익 관점", "운영 프로세스 관점"] },
      { id: "q2", question: hints[1] || "결과물의 1차 활용 목적은 무엇인가요?", options: ["의사결정 보고", "실무 개선", "추가 실험 설계"] },
      { id: "q3", question: hints[2] || "분석의 깊이는 어느 수준이 적절한가요?", options: ["빠른 현황 파악", "원인 분석", "실행안 도출"] },
    ],
  };
}

function fallbackResultContract(title: string, detail: string): Record<string, unknown> {
  const text = `${title} ${detail}`;
  const kind = /비교|차이|증감|대비|순위/.test(text)
    ? "comparison"
    : /로그인|로그아웃|브라우저|절차|전환|설정|체크리스트/.test(text)
      ? "procedure"
      : /보고서|정책|지역|현황|산업|회의|요약/.test(text)
        ? "report"
        : /비용|원가|단가|수문|인원|시간|수량|계산|금액|비율/.test(text)
          ? "calculation"
          : "summary_decision";
  const missing = ["원본 근거와 결과에 필요한 입력값 확인"];
  const contract: Record<string, unknown> = {
    kind,
    title: title.slice(0, 160),
    status: "needs_evidence",
    answer: detail.slice(0, 1600) || "원본 근거와 입력값을 확인한 뒤 결과를 확정합니다.",
    result_value: null,
    formula: kind === "calculation" ? {
      expression: "입력값 확인 후 적용 수식 확정",
      result: null,
      unit: "",
      status: "input_required",
      variables: [],
    } : null,
    comparison_rows: [],
    report_sections: kind === "report" ? [
      { heading: "분석 범위", body: detail.slice(0, 2000) || "선택한 자료의 범위를 확인합니다." },
      { heading: "확인 필요 사항", body: "원본 근거와 누락된 입력값을 확인한 뒤 보고서 본문을 확정합니다." },
    ] : [],
    checklist: kind === "procedure" ? [{ label: "원본 자료와 실행 환경 확인", note: "AI가 외부 시스템을 대신 조작하지 않았습니다.", status: "needs_user_action", result: "사용자 확인 필요" }] : [],
    evidence_refs: [],
    missing_inputs: missing,
    human_input_fields: [],
    user_goal: title.slice(0, 500),
    assumptions: [],
    next_actions: ["원본 근거 확인", "필수 입력값 확정", "결과 재실행"],
  };
  return contract;
}

function normalizePlansPayload(parsed: unknown, raw: string): { plans: AnalysisPlanItem[] } {
  const obj = asRecord(parsed);
  const arr = Array.isArray(obj?.plans) ? obj.plans : [];
  const plans: AnalysisPlanItem[] = [];
  arr.forEach((item, index) => {
    const rec = asRecord(item);
    if (!rec) return;
    const title = asString(rec.title) || asString(rec.name);
    if (!title) return;
    plans.push({
      id: asString(rec.id) || `p${index + 1}`,
      title: title.slice(0, 160),
      detail: (asString(rec.detail) || asString(rec.description)).slice(0, 320),
      checked: asBool(rec.checked, index < 4),
      result_contract: normalizeResultContract(rec.result_contract || rec.resultContract, title)
        || fallbackResultContract(title, asString(rec.detail) || asString(rec.description)),
    });
  });
  if (plans.length) return { plans: plans.slice(0, 8) };

  const lines = raw.split(/\r?\n/).map((line) => line.replace(/^[-*#\d.\s]+/, "").trim()).filter(Boolean).slice(0, 6);
  const fallback = lines.length ? lines : [
    "분석 목적과 핵심 질문 확정",
    "자료별 주요 지표와 결측/품질 확인",
    "정량 지표의 추세와 이상치 분석",
    "정성 메모와 회의록 기반 가설 정리",
    "인사이트 우선순위화",
    "최종 리포트 및 실행안 작성",
  ];
  return { plans: fallback.map((title, index) => ({
    id: `p${index + 1}`,
    title,
    detail: "",
    checked: index < 4,
    result_contract: fallbackResultContract(title, ""),
  })) };
}

function scalarResultValue(value: unknown): string | number | boolean | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().slice(0, 240) || null;
  return null;
}

function normalizeChecklist(value: unknown, max = 20): Array<Record<string, unknown> | string> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item.trim().slice(0, 400);
    const rec = asRecord(item);
    if (!rec) return "";
    return {
      label: asString(rec.label || rec.task || rec.title).slice(0, 240),
      note: asString(rec.note || rec.detail || rec.result).slice(0, 600),
      status: asString(rec.status).slice(0, 40) || "todo",
      result: asString(rec.result).slice(0, 600),
    };
  }).filter((item) => typeof item === "string" ? !!item : !!item.label).slice(0, max);
}

function normalizeHumanEvidenceRecord(value: unknown): Record<string, unknown> | string | null {
  if (typeof value === "string") return value.trim().slice(0, 600) || null;
  const rec = asRecord(value);
  if (!rec) return null;
  const normalized: Record<string, unknown> = {
    file_id: asString(rec.file_id || rec.fileId).slice(0, 120),
    file_name: asString(rec.file_name || rec.file).slice(0, 180),
    page: scalarResultValue(rec.page),
    sheet: asString(rec.sheet).slice(0, 120),
    range: asString(rec.range || rec.cell).slice(0, 80),
    excerpt: asString(rec.excerpt || rec.text).slice(0, 600),
    label: asString(rec.label).slice(0, 160),
    source: asString(rec.source).slice(0, 240),
    url: asString(rec.url || rec.download_url).slice(0, 1000),
    chunk_id: asString(rec.chunk_id || rec.chunkId).slice(0, 160),
    score: scalarResultValue(rec.score),
  };
  const hasValue = Object.values(normalized).some((item) => item !== "" && item !== null);
  return hasValue ? normalized : null;
}

function normalizeHumanEvidence(value: unknown, max = 8): Array<Record<string, unknown> | string> {
  const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return values
    .map(normalizeHumanEvidenceRecord)
    .filter((item): item is Record<string, unknown> | string => item !== null)
    .slice(0, max);
}

function normalizeHumanConfirmedInputs(value: unknown): Record<string, unknown>[] {
  return recordArray(value, 20).map((input) => {
    const candidate = asRecord(input.candidate);
    const evidence = normalizeHumanEvidence(input.evidence, 8);
    const evidenceRefs = normalizeHumanEvidence(
      input.evidence_refs ?? input.evidenceRefs ?? candidate?.evidence_refs ?? candidate?.evidenceRefs,
      8,
    );
    return {
      field_id: asString(input.field_id || input.fieldId || input.id || input.label).slice(0, 80),
      label: asString(input.label).slice(0, 160),
      kind: asString(input.kind).slice(0, 40) || "text",
      value: scalarResultValue(input.value),
      unit: asString(input.unit).slice(0, 40),
      source: asString(input.source || candidate?.source).slice(0, 240),
      confidence: scalarResultValue(input.confidence ?? candidate?.confidence),
      human_verified: input.human_verified === true || input.humanVerified === true,
      memo: asString(input.memo).slice(0, 600),
      evidence,
      evidence_refs: evidenceRefs,
    };
  });
}

function normalizeResultContract(value: unknown, fallbackTitle: string): Record<string, unknown> | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const allowedKinds = new Set(["calculation", "comparison", "report", "procedure", "summary_decision"]);
  const allowedStatuses = new Set(["ready", "needs_input", "needs_evidence", "needs_user_action"]);
  const kind = allowedKinds.has(asString(rec.kind)) ? asString(rec.kind) : "summary_decision";
  const status = allowedStatuses.has(asString(rec.status)) ? asString(rec.status) : "needs_evidence";
  const resultValue = asRecord(rec.result_value || rec.resultValue);
  const formula = asRecord(rec.formula);
  const normalized: Record<string, unknown> = {
    kind,
    title: (asString(rec.title) || fallbackTitle).slice(0, 160),
    status,
    answer: asString(rec.answer).slice(0, 1600),
    result_value: resultValue ? {
      label: asString(resultValue.label).slice(0, 120),
      value: scalarResultValue(resultValue.value),
      raw_number: typeof resultValue.raw_number === "number" && Number.isFinite(resultValue.raw_number) ? resultValue.raw_number : null,
      unit: asString(resultValue.unit).slice(0, 40),
    } : null,
    formula: formula ? {
      expression: asString(formula.expression).slice(0, 500),
      result: scalarResultValue(formula.result),
      unit: asString(formula.unit).slice(0, 40),
      status: asString(formula.status).slice(0, 40) || "needs_review",
      variables: recordArray(formula.variables, 12).map((variable) => ({
        name: asString(variable.name).slice(0, 100),
        value: scalarResultValue(variable.value),
        unit: asString(variable.unit).slice(0, 40),
        evidence: asString(variable.evidence).slice(0, 240),
      })),
    } : null,
    comparison_rows: recordArray(rec.comparison_rows || rec.comparisonRows, 20).map((row) => ({
      item: asString(row.item || row.label).slice(0, 160),
      result: scalarResultValue(row.result ?? row.value),
      evidence: asString(row.evidence).slice(0, 400),
    })),
    report_sections: recordArray(rec.report_sections || rec.reportSections, 12).map((section) => ({
      heading: asString(section.heading || section.title).slice(0, 160),
      body: asString(section.body || section.text).slice(0, 2000),
    })),
    checklist: normalizeChecklist(rec.checklist, 20),
    evidence_refs: recordArray(rec.evidence_refs || rec.evidenceRefs, 12).map((ref) => ({
      file_name: asString(ref.file_name || ref.file).slice(0, 180),
      page: scalarResultValue(ref.page),
      sheet: asString(ref.sheet).slice(0, 120),
      range: asString(ref.range).slice(0, 80),
      excerpt: asString(ref.excerpt || ref.text).slice(0, 600),
    })),
    missing_inputs: stringArray(rec.missing_inputs || rec.missingInputs, 12).map((item) => item.slice(0, 160)),
    human_input_fields: recordArray(rec.human_input_fields || rec.humanInputFields, 20).map((field) => ({
      id: asString(field.id || field.label).slice(0, 80),
      label: asString(field.label).slice(0, 160),
      kind: asString(field.kind).slice(0, 40) || "text",
      reason: asString(field.reason).slice(0, 400),
      impact: asString(field.impact).slice(0, 20) || "medium",
      required: field.required !== false,
      status: asString(field.status).slice(0, 30) || "pending",
      value: scalarResultValue(field.value),
      unit: asString(field.unit).slice(0, 40),
      selection: asString(field.selection).slice(0, 80),
      source: asString(field.source).slice(0, 240),
      human_verified: field.human_verified === true || field.humanVerified === true,
      candidate_confidence: scalarResultValue(field.candidate_confidence ?? field.candidateConfidence),
      candidates: recordArray(field.candidates, 8).map((candidate) => ({
        value: scalarResultValue(candidate.value),
        unit: asString(candidate.unit).slice(0, 40),
        label: asString(candidate.label).slice(0, 160),
        confidence: scalarResultValue(candidate.confidence),
        source: asString(candidate.source).slice(0, 240),
        scenario_key: asString(candidate.scenario_key || candidate.scenarioKey).slice(0, 240),
        evidence_refs: normalizeHumanEvidence(candidate.evidence_refs || candidate.evidenceRefs, 8),
      })),
    })),
    human_confirmed_inputs: normalizeHumanConfirmedInputs(rec.human_confirmed_inputs || rec.humanConfirmedInputs),
    user_goal: asString(rec.user_goal || rec.userGoal).slice(0, 500),
    assumptions: stringArray(rec.assumptions, 12).map((item) => item.slice(0, 500)),
    next_actions: stringArray(rec.next_actions || rec.nextActions, 12).map((item) => item.slice(0, 300)),
  };
  return normalized;
}

function normalizeManualPayload(parsed: unknown, raw: string, session: AnalysisSessionRow): AnalysisManualPayload {
  const obj = asRecord(parsed);
  const docType = asString(obj?.doc_type) === "memo" ? "memo" : "manual";
  const stepsArr = Array.isArray(obj?.steps) ? obj!.steps : [];
  const steps: AnalysisManualStep[] = [];
  stepsArr.forEach((item) => {
    const rec = asRecord(item);
    if (!rec) return;
    const title = asString(rec.title) || asString(rec.name);
    const actions = stringArray(rec.actions || rec.steps || rec.detail, 8).map((a) => a.slice(0, 300));
    if (!title && !actions.length) return;
    steps.push({
      title: (title || "단계").slice(0, 160),
      actions,
      screenshot_caption: asString(rec.screenshot_caption || rec.screenshot || rec.image).slice(0, 160) || undefined,
      warning: asString(rec.warning || rec.caution || rec.note).slice(0, 300) || undefined,
    });
  });

  const faqArr = Array.isArray(obj?.faq) ? obj!.faq : [];
  const faq: { q: string; a: string }[] = [];
  faqArr.forEach((item) => {
    const rec = asRecord(item);
    if (!rec) return;
    const q = asString(rec.q || rec.question);
    const a = asString(rec.a || rec.answer);
    if (q && a) faq.push({ q: q.slice(0, 200), a: a.slice(0, 400) });
  });

  const payload: AnalysisManualPayload = {
    doc_type: docType,
    title: (asString(obj?.title) || session.title || "매뉴얼").slice(0, 200),
    purpose: (asString(obj?.purpose) || asString(obj?.overview)).slice(0, 600),
    audience: asString(obj?.audience).slice(0, 200) || undefined,
    prerequisites: stringArray(obj?.prerequisites || obj?.prep, 8).map((p) => p.slice(0, 240)),
    steps: steps.slice(0, 20),
    checklist: stringArray(obj?.checklist || obj?.checks, 12).map((c) => c.slice(0, 240)),
    faq: faq.slice(0, 8),
    note: asString(obj?.note).slice(0, 400) || undefined,
  };

  if (payload.steps.length) return payload;

  // 폴백: 구조화 실패 시 원문 줄을 단계로 변환해 최소한의 매뉴얼 형태를 보장한다.
  const lines = raw.split(/\r?\n/).map((line) => line.replace(/^[-*#\d.\s]+/, "").trim()).filter(Boolean);
  payload.steps = lines.slice(0, 8).map((line) => ({ title: line.slice(0, 160), actions: [] }));
  if (!payload.purpose) payload.purpose = lines[0]?.slice(0, 600) || "AI 응답을 구조화하지 못했습니다. 원문 응답을 확인해 주세요.";
  return payload;
}

async function requireSession(env: Env, userId: string, sessionId: string): Promise<AnalysisSessionRow> {
  const row = await env.DB.prepare(
    `SELECT id, user_id, title, date, subject, meeting_r2_key, etc_url, etc_note, created_at, updated_at
     FROM analysis_sessions WHERE id=? AND user_id=?`
  ).bind(sessionId, userId).first<AnalysisSessionRow>();
  if (!row) throw new AnalysisError(404, "분석 세션을 찾을 수 없습니다.");
  return row;
}

async function readMeetingMarkdown(env: Env, session: AnalysisSessionRow): Promise<string> {
  if (!session.meeting_r2_key) return "";
  const obj = await env.R2.get(session.meeting_r2_key);
  return obj ? (await obj.text()).slice(0, 20000) : "";
}

async function putMeetingMarkdown(env: Env, userId: string, sessionId: string, markdown: string): Promise<string | null> {
  const text = markdown.trim();
  if (!text) return null;
  const key = `analysis/${safeUserKey(userId)}/${sessionId}/meeting.md`;
  await env.R2.put(key, text.slice(0, 100000), { httpMetadata: { contentType: "text/markdown; charset=utf-8" } });
  return key;
}

export async function createAnalysisSession(env: Env, userId: string, input: AnalysisSessionInput) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const subject = cleanOptional(input.subject, 200);
  const date = cleanOptional(input.date, 20);
  const title = cleanOptional(input.title, 200) || `${date || now.slice(0, 10)} 분석설계${subject ? ` - ${subject}` : ""}`;
  const meetingKey = typeof input.meetingMarkdown === "string"
    ? await putMeetingMarkdown(env, userId, id, input.meetingMarkdown)
    : null;

  await env.DB.prepare(
    `INSERT INTO analysis_sessions (id, user_id, title, date, subject, meeting_r2_key, etc_url, etc_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, userId, title, date, subject, meetingKey,
    cleanOptional(input.etcUrl, 1000), cleanOptional(input.etcNote, 6000), now, now
  ).run();

  return { id, title, date, subject, created_at: now };
}

export async function updateAnalysisSession(env: Env, userId: string, sessionId: string, input: AnalysisSessionInput): Promise<AnalysisSessionRow> {
  const current = await requireSession(env, userId, sessionId);
  let meetingKey = current.meeting_r2_key;
  if (hasOwn(input, "meetingMarkdown")) {
    if (input.meetingMarkdown?.trim()) {
      meetingKey = await putMeetingMarkdown(env, userId, sessionId, input.meetingMarkdown);
    } else {
      if (current.meeting_r2_key) await env.R2.delete(current.meeting_r2_key);
      meetingKey = null;
    }
  }
  const subject = hasOwn(input, "subject") ? cleanOptional(input.subject, 200) : current.subject;
  const date = hasOwn(input, "date") ? cleanOptional(input.date, 20) : current.date;
  const title = hasOwn(input, "title") ? cleanOptional(input.title, 200) : current.title;
  const etcUrl = hasOwn(input, "etcUrl") ? cleanOptional(input.etcUrl, 1000) : current.etc_url;
  const etcNote = hasOwn(input, "etcNote") ? cleanOptional(input.etcNote, 6000) : current.etc_note;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE analysis_sessions
     SET title=?, date=?, subject=?, meeting_r2_key=?, etc_url=?, etc_note=?, updated_at=?
     WHERE id=? AND user_id=?`
  ).bind(title, date, subject, meetingKey, etcUrl, etcNote, now, sessionId, userId).run();
  return requireSession(env, userId, sessionId);
}

export async function listAnalysisSessions(env: Env, userId: string, limitValue?: number) {
  // Garden·자료 픽커가 limit=200 으로 최근 목록을 요청한다 — clamp 를 그보다 줄이면 드롭다운에서 자료가 잘린다.
  const limit = Math.min(200, Math.max(1, Number(limitValue) || 20));
  const { results } = await env.DB.prepare(
    `SELECT
       s.id, s.user_id, s.title, s.date, s.subject, s.meeting_r2_key, s.etc_url, s.etc_note, s.created_at, s.updated_at,
       COUNT(DISTINCT f.id) AS file_count,
       MAX(o.created_at) AS latest_output_at
     FROM analysis_sessions s
     LEFT JOIN analysis_files f ON f.session_id=s.id AND f.user_id=s.user_id
     LEFT JOIN analysis_outputs o ON o.session_id=s.id AND o.user_id=s.user_id
     WHERE s.user_id=?
     GROUP BY s.id
     ORDER BY s.updated_at DESC
     LIMIT ?`
  ).bind(userId, limit).all<AnalysisSessionRow & { file_count: number; latest_output_at: string | null }>();

  return {
    sessions: (results || []).map((row) => ({
      ...publicSession(row),
      file_count: row.file_count || 0,
      latest_output_at: row.latest_output_at || null,
    })),
  };
}

export async function latestOutputs(env: Env, userId: string, sessionId: string) {
  const { results } = await env.DB.prepare(
    `SELECT kind, content_json, provider, model, input_tokens, output_tokens, created_at
     FROM analysis_outputs
     WHERE session_id=? AND user_id=?
     ORDER BY created_at DESC
     LIMIT 30`
  ).bind(sessionId, userId).all<AnalysisOutputRow>();

  const outputs: Record<string, ReturnType<typeof parseOutputRow>> = {};
  for (const row of results || []) {
    if (!outputs[row.kind]) outputs[row.kind] = parseOutputRow(row);
  }
  return outputs;
}

export async function getAnalysisSessionDetail(env: Env, userId: string, sessionId: string) {
  const session = await requireSession(env, userId, sessionId);
  const [meetingMarkdown, files, outputs] = await Promise.all([
    readMeetingMarkdown(env, session),
    listAnalysisFiles(env, userId, sessionId),
    latestOutputs(env, userId, sessionId),
  ]);
  return {
    session: publicSession(session, meetingMarkdown),
    files: files.map(publicFile),
    outputs,
  };
}

export async function patchAnalysisSession(env: Env, userId: string, sessionId: string, body: unknown) {
  const session = await updateAnalysisSession(env, userId, sessionId, analysisInputFromBody(body));
  return { session: publicSession(session, await readMeetingMarkdown(env, session)) };
}

function isFileEntry(value: unknown): value is File {
  return typeof value === "object" && value !== null &&
    "name" in value && typeof value.name === "string" &&
    "arrayBuffer" in value && typeof value.arrayBuffer === "function";
}

// 클라이언트가 보낸 client_texts(JSON 배열) 파싱 — files 순서와 정렬된 (string|null)[].
function parseClientTexts(raw: unknown): (string | null)[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => (typeof t === "string" && t.trim() ? t : null));
  } catch {
    return [];
  }
}

function safeAnalysisIndexError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "indexing failed");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:key|token|secret)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 600);
}

export async function saveAnalysisFilesFromRequest(env: Env, userId: string, sessionId: string, request: Request) {
  await requireSession(env, userId, sessionId);
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_UPLOAD_BYTES) throw new AnalysisError(413, `업로드는 한 번에 ${fmtBytes(MAX_UPLOAD_BYTES)}까지 가능합니다.`);

  const existing = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM analysis_files WHERE session_id=? AND user_id=?"
  ).bind(sessionId, userId).first<{ count: number }>();
  const form = await request.formData();
  const entries = form.getAll("files") as unknown[];
  const files = entries.filter(isFileEntry);
  if (!files.length) throw new AnalysisError(400, "업로드할 파일이 없습니다.");
  // 클라이언트가 추출한 텍스트(PDF 등) — files 와 순서를 맞춘 배열. 서버 파서가 없는 형식의 본문으로 사용.
  const clientTexts = parseClientTexts(form.get("client_texts"));
  if ((existing?.count || 0) + files.length > MAX_FILES_PER_SESSION)
    throw new AnalysisError(400, `분석 세션 하나에는 파일을 최대 ${MAX_FILES_PER_SESSION}개까지 등록할 수 있습니다.`);

  const saved: AnalysisFileRow[] = [];
  let totalBytes = 0;
  for (let idx = 0; idx < files.length; idx++) {
    const file = files[idx];
    if (!file.size) continue;
    if (file.size > MAX_FILE_BYTES) throw new AnalysisError(413, `파일 하나는 ${fmtBytes(MAX_FILE_BYTES)}까지 가능합니다: ${file.name}`);
    totalBytes += file.size;
    if (totalBytes > MAX_UPLOAD_BYTES) throw new AnalysisError(413, `업로드는 한 번에 ${fmtBytes(MAX_UPLOAD_BYTES)}까지 가능합니다.`);

    const id = crypto.randomUUID();
    const name = safeName(file.name);
    const type = file.type || "application/octet-stream";
    const key = `analysis/${safeUserKey(userId)}/${sessionId}/${id}/${name}`;
    const buffer = await file.arrayBuffer();
    await env.R2.put(key, buffer, { httpMetadata: { contentType: type } });

    let textExcerpt: string | null = null;
    if (isLikelyText(name, type)) {
      textExcerpt = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(buffer)
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, MAX_TEXT_CHARS_PER_FILE);
    } else if (clientTexts[idx]) {
      // 서버 파서가 없는 형식(PDF 등)은 클라이언트가 추출한 텍스트를 사용.
      textExcerpt = (clientTexts[idx] as string).replace(/\u0000/g, "").trim().slice(0, MAX_TEXT_CHARS_PER_FILE) || null;
    }

    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO analysis_files
         (id, session_id, user_id, name, type, size, r2_key, text_excerpt,
          index_status, index_attempts, index_updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
    ).bind(id, sessionId, userId, name, type, file.size, key, textExcerpt, now, now).run();
    const savedFile: AnalysisFileRow = {
      id,
      session_id: sessionId,
      user_id: userId,
      name,
      type,
      size: file.size,
      r2_key: key,
      text_excerpt: textExcerpt,
      index_status: "pending",
      index_error: null,
      index_attempts: 0,
      index_run_id: null,
      index_updated_at: now,
      indexed_at: null,
      created_at: now,
    };
    const job: AnalysisIndexJob = {
      type: "analysis_index",
      session_id: sessionId,
      user_id: userId,
      file_id: id,
    };
    try {
      await env.ANALYSIS_INDEX_QUEUE.send(job, { contentType: "json" });
    } catch (error) {
      const errorMessage = safeAnalysisIndexError(error);
      await markAnalysisIndexFailed(env, job, errorMessage, 0);
      console.error(JSON.stringify({
        service: "analysis-index",
        event: "enqueue_failed",
        session_id: sessionId,
        file_id: id,
        error: errorMessage,
      }));
      throw new AnalysisError(503, "파일은 저장했지만 인덱싱 작업을 등록하지 못했습니다. 잠시 후 다시 시도하세요.", "analysis_index_enqueue_failed");
    }
    saved.push(savedFile);
  }

  if (!saved.length) throw new AnalysisError(400, "저장할 수 있는 파일이 없습니다.");
  return {
    session_id: sessionId,
    files: saved.map((file) => ({
      id: file.id,
      name: file.name,
      type: file.type,
      size: file.size,
      text_available: !!file.text_excerpt,
      text_extract_reason: textExtractReason(file.name, file.type, file.text_excerpt),
      index_status: file.index_status,
      created_at: file.created_at,
    })),
  };
}

export async function deleteAnalysisFile(env: Env, userId: string, sessionId: string, fileId: string) {
  await requireSession(env, userId, sessionId);
  const row = await env.DB.prepare(
    "SELECT r2_key FROM analysis_files WHERE id=? AND session_id=? AND user_id=?"
  ).bind(fileId, sessionId, userId).first<{ r2_key: string }>();
  if (!row) throw new AnalysisError(404, "분석파일을 찾을 수 없습니다.");
  await env.R2.delete(row.r2_key);
  try { await deleteFileChunks(env, userId, sessionId, fileId); } catch { /* 파일 삭제는 계속 진행 */ }
  try { await deleteFileGraph(env, userId, sessionId, fileId); } catch { /* 파일 삭제는 계속 진행 */ }
  await env.DB.prepare(
    "DELETE FROM analysis_files WHERE id=? AND session_id=? AND user_id=?"
  ).bind(fileId, sessionId, userId).run();
  return { ok: true };
}

export async function deleteAnalysisSession(env: Env, userId: string, sessionId: string) {
  const session = await requireSession(env, userId, sessionId);
  const files = await listAnalysisFiles(env, userId, sessionId);
  await Promise.all([
    ...files.map((file) => env.R2.delete(file.r2_key)),
    session.meeting_r2_key ? env.R2.delete(session.meeting_r2_key) : Promise.resolve(),
  ]);
  await env.DB.prepare("DELETE FROM analysis_outputs WHERE session_id=? AND user_id=?").bind(sessionId, userId).run();
  await env.DB.prepare("DELETE FROM analysis_pipeline_runs WHERE session_id=? AND user_id=?").bind(sessionId, userId).run();
  try { await deleteSessionChunks(env, userId, sessionId); } catch { /* 세션 삭제는 계속 진행 */ }
  try { await deleteSessionGraph(env, userId, sessionId); } catch { /* 세션 삭제는 계속 진행 */ }
  await env.DB.prepare("DELETE FROM analysis_files WHERE session_id=? AND user_id=?").bind(sessionId, userId).run();
  await env.DB.prepare("DELETE FROM analysis_sessions WHERE id=? AND user_id=?").bind(sessionId, userId).run();
  return { ok: true };
}

async function listAnalysisFiles(env: Env, userId: string, sessionId: string): Promise<AnalysisFileRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, session_id, user_id, name, type, size, r2_key, text_excerpt,
            index_status, index_error, index_attempts, index_run_id, index_updated_at, indexed_at, created_at
     FROM analysis_files WHERE session_id=? AND user_id=? ORDER BY created_at`
  ).bind(sessionId, userId).all<AnalysisFileRow>();
  return results || [];
}

export async function getAnalysisIndexStatus(env: Env, userId: string, sessionId: string) {
  await requireSession(env, userId, sessionId);
  const files = await listAnalysisFiles(env, userId, sessionId);
  const counts = files.reduce((summary, file) => {
    summary[file.index_status] += 1;
    return summary;
  }, { pending: 0, indexing: 0, done: 0, failed: 0 });
  const indexStatus = !files.length
    ? "idle"
    : counts.failed > 0
      ? "failed"
      : counts.indexing > 0
        ? "indexing"
        : counts.pending > 0
          ? "pending"
          : "done";
  return {
    session_id: sessionId,
    index_status: indexStatus,
    counts,
    files: files.map(publicFile),
  };
}

export async function processAnalysisIndexJob(
  env: Env,
  job: AnalysisIndexJob,
  runId: string,
  attempts: number,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE analysis_files
     SET index_status='indexing', index_error=NULL, index_run_id=?,
         index_attempts=MAX(index_attempts, ?), index_updated_at=?
     WHERE id=? AND session_id=? AND user_id=? AND index_status<>'done'
       AND (index_status<>'indexing' OR index_updated_at IS NULL OR index_updated_at<?)`
  ).bind(
    runId,
    Math.max(1, attempts),
    now,
    job.file_id,
    job.session_id,
    job.user_id,
    staleBefore,
  ).run();

  if (!Number(claim.meta.changes || 0)) {
    const current = await env.DB.prepare(
      "SELECT index_status FROM analysis_files WHERE id=? AND session_id=? AND user_id=?"
    ).bind(job.file_id, job.session_id, job.user_id).first<{ index_status: string }>();
    if (!current) return { status: "missing" };
    return { status: current.index_status === "done" ? "already_done" : "busy" };
  }

  const file = await env.DB.prepare(
    `SELECT id, session_id, user_id, name, type, size, r2_key, text_excerpt,
            index_status, index_error, index_attempts, index_run_id, index_updated_at, indexed_at, created_at
     FROM analysis_files WHERE id=? AND session_id=? AND user_id=? AND index_run_id=?`
  ).bind(job.file_id, job.session_id, job.user_id, runId).first<AnalysisFileRow>();
  if (!file) throw new Error("인덱싱 대상을 찾지 못했습니다.");

  let chunks = 0;
  let vectorized = 0;
  let nodes = 0;
  let edges = 0;
  if (file.text_excerpt?.trim()) {
    const rag = await syncFileChunks(env, job.user_id, job.session_id, file, { failOnVectorizeError: true });
    chunks = rag.chunks;
    vectorized = rag.vectorized;
    const graph = await syncFileGraph(env, job.user_id, job.session_id, file.id);
    nodes = graph.nodes;
    edges = graph.edges;
  }

  const completedAt = new Date().toISOString();
  const completed = await env.DB.prepare(
    `UPDATE analysis_files
     SET index_status='done', index_error=NULL, index_run_id=NULL,
         index_updated_at=?, indexed_at=?
     WHERE id=? AND session_id=? AND user_id=? AND index_run_id=?`
  ).bind(
    completedAt,
    completedAt,
    job.file_id,
    job.session_id,
    job.user_id,
    runId,
  ).run();
  if (!Number(completed.meta.changes || 0)) return { status: "superseded" };
  return { status: "done", chunks, vectorized, nodes, edges };
}

export async function markAnalysisIndexRetry(
  env: Env,
  job: AnalysisIndexJob,
  runId: string,
  errorMessage: string,
  attempts: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE analysis_files
     SET index_status='pending', index_error=?, index_run_id=NULL,
         index_attempts=MAX(index_attempts, ?), index_updated_at=?
     WHERE id=? AND session_id=? AND user_id=? AND index_status<>'done' AND index_run_id=?`
  ).bind(
    errorMessage.slice(0, 600),
    Math.max(1, attempts),
    new Date().toISOString(),
    job.file_id,
    job.session_id,
    job.user_id,
    runId,
  ).run();
}

export async function markAnalysisIndexFailed(
  env: Env,
  job: AnalysisIndexJob,
  errorMessage: string,
  attempts: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE analysis_files
     SET index_status='failed', index_error=?, index_run_id=NULL,
         index_attempts=MAX(index_attempts, ?), index_updated_at=?
     WHERE id=? AND session_id=? AND user_id=? AND index_status<>'done'`
  ).bind(
    errorMessage.slice(0, 600),
    Math.max(0, attempts),
    new Date().toISOString(),
    job.file_id,
    job.session_id,
    job.user_id,
  ).run();
}

async function latestOutput(env: Env, userId: string, sessionId: string, kind: string): Promise<Record<string, unknown> | null> {
  const row = await env.DB.prepare(
    `SELECT content_json FROM analysis_outputs
     WHERE session_id=? AND user_id=? AND kind=? ORDER BY created_at DESC LIMIT 1`
  ).bind(sessionId, userId, kind).first<{ content_json: string }>();
  if (!row?.content_json) return null;
  try {
    const parsed = JSON.parse(row.content_json);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

async function storeOutput(
  env: Env,
  userId: string,
  sessionId: string,
  kind: string,
  content: Record<string, unknown>,
  out: GenerateTextResult,
  dagshubRunUrl: string | null = null
) {
  await env.DB.prepare(
    `INSERT INTO analysis_outputs (session_id, user_id, kind, content_json, provider, model, input_tokens, output_tokens, dagshub_run_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sessionId, userId, kind, JSON.stringify(content), out.provider, out.model, out.inputTokens, out.outputTokens, dagshubRunUrl, new Date().toISOString()).run();
}

async function storeOutputJson(
  env: Env,
  userId: string,
  sessionId: string,
  kind: string,
  content: Record<string, unknown>,
  provider = "local",
  model = "deterministic"
) {
  await env.DB.prepare(
    `INSERT INTO analysis_outputs (session_id, user_id, kind, content_json, provider, model, input_tokens, output_tokens, dagshub_run_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sessionId, userId, kind, JSON.stringify(content), provider, model, 0, 0, null, new Date().toISOString()).run();
}

async function runMetered(env: Env, userId: string, prompt: string, settings: AISettings): Promise<MeteredText> {
  const quota = await checkQuota(env, userId);
  if (!quota.allowed)
    throw new AnalysisError(429, `오늘 사용 한도(${quota.limit}원)를 초과했습니다.`);
  const started = Date.now();
  const out = await generateText(env, prompt, settings);
  const latencyMs = Date.now() - started;
  const cost = await logUsage(env, userId, out.provider, out.model, out.inputTokens, out.outputTokens);
  return { out, cost, usedBefore: quota.used, quota, latencyMs };
}

function meteredFields(run: MeteredText) {
  return {
    provider: run.out.provider,
    model: run.out.model,
    usage: { input_tokens: run.out.inputTokens, output_tokens: run.out.outputTokens },
    cost_krw: run.cost,
    day_used_krw: run.usedBefore + run.cost,
    limit_krw: run.quota.limit,
    warn_threshold_krw: run.quota.warnThreshold,
    warning: run.usedBefore + run.cost >= run.quota.limit
      ? { kind: "limit", message: run.quota.blockOnExceed ? "오늘 AI 사용 한도를 초과해 다음 요청부터 차단됩니다." : "오늘 AI 사용 한도를 초과했습니다." }
      : run.usedBefore + run.cost >= run.quota.warnThreshold
        ? { kind: "warning", message: "오늘 AI 사용액이 예산 알림 임계치를 넘었습니다." }
        : run.quota.warning,
    fallback_from: run.out.fallbackFrom ?? null,
  };
}

// 실사용(분석설계) 1건 = DagsHub 환경별 usage experiment 의 MLflow run 1건.
// 정답셋이 없으므로 accuracy 대신 운영 지표(latency/토큰/비용) 위주로 기록한다.
// logDagsHubRun 은 throw 하지 않으므로 DagsHub 장애가 분석 생성을 막지 않는다.
async function logStageUsage(env: Env, userId: string, sessionId: string, stage: string, run: MeteredText): Promise<string | null> {
  try {
    const res = await logDagsHubRun(env, {
      experiment: usageExperiment(env),
      source: "usage",
      runName: `${run.out.provider}/${run.out.model} · ${stage}`,
      status: "FINISHED",
      tags: {
        stage,
        provider: run.out.provider,
        model: run.out.model,
        user_id: userId,
        session_id: sessionId,
        fallback_from: run.out.fallbackFrom ?? null,
      },
      params: {
        stage,
        provider: run.out.provider,
        model: run.out.model,
      },
      metrics: {
        latency_ms: run.latencyMs,
        input_tokens: run.out.inputTokens,
        output_tokens: run.out.outputTokens,
        cost_krw: run.cost,
      },
    });
    return res.url;
  } catch { /* DagsHub 기록 실패는 무시 */ return null; }
}

function filesContext(files: AnalysisFileRow[], retrievedContext?: string | null): string {
  if (retrievedContext) {
    const fileList = files.map((file) => `- ${file.name} (file_id=${file.id}, ${fmtBytes(file.size)})`).join("\n");
    return trimContext(`[RAG 검색 근거 청크]\n${retrievedContext}\n\n[참고 파일 목록]\n${fileList}`);
  }
  if (!files.length) return "(분석파일 없음. 회의록 참고자료와 작업공간 메모를 기반으로 진행합니다.)";
  const chunks: string[] = [];
  for (const file of files) {
    chunks.push([
      `파일 ID: ${file.id}`,
      `파일명: ${file.name}`,
      `형식: ${file.type || "-"} / 크기: ${fmtBytes(file.size)}`,
      "내용 발췌:",
      file.text_excerpt || "(이 파일은 텍스트 발췌가 불가능합니다. 파일명과 메모만 참고하세요.)",
    ].join("\n"));
  }
  return trimContext(chunks.join("\n\n---\n\n"));
}

function baseContext(session: AnalysisSessionRow, meetingMarkdown: string): string {
  return [
    `분석 제목: ${session.title || "-"}`,
    `날짜: ${session.date || "-"}`,
    `주제: ${session.subject || "-"}`,
    `참고 URL: ${session.etc_url || "-"}`,
    `연구원 메모: ${session.etc_note || "-"}`,
    "",
    "회의록:",
    meetingMarkdown || "(회의록 없음)",
  ].join("\n");
}

function isRetrieverSearchMode(meetingMarkdown: string, files: AnalysisFileRow[]): boolean {
  return !files.length && !meetingMarkdown.trim();
}

function forceSearchSettings(settings: AISettings): AISettings {
  return {
    ...settings,
    model: SEARCH_MODEL_BY_PROVIDER[settings.provider] || settings.model,
    purpose: "search",
    webSearch: true,
  };
}

function retrieverSearchContext(session: AnalysisSessionRow): string {
  return [
    "분석파일과 회의록이 없는 상태입니다.",
    "기대 산출물, 의사결정 기준, 참고 URL, 작업공간 정보를 검색 질의와 분석 기준으로 사용하세요.",
    "웹 검색 도구가 제공되면 반드시 사용하고, 확인 가능한 출처와 추정/불확실성을 분리하세요.",
    "예: 기대 산출물이 '갤럭시 s25 제조원가'이면 Galaxy S25 BOM, teardown, component cost, manufacturing cost 관련 최신 공개 근거를 찾고 원가 범위와 산정 근거를 요약하세요.",
    "",
    "[검색 입력]",
    `작업공간: ${session.subject || "-"}`,
    `기대 산출물/의사결정 기준/메모: ${session.etc_note || "-"}`,
    `참고 URL: ${session.etc_url || "-"}`,
  ].join("\n");
}

function assertAnalysisFilesIndexed(files: AnalysisFileRow[]): void {
  const blocked = files.filter((file) => file.index_status !== "done");
  if (!blocked.length) return;
  const failed = blocked.filter((file) => file.index_status === "failed");
  throw new AnalysisError(
    409,
    failed.length
      ? "일부 분석파일 인덱싱에 실패했습니다. 상태를 확인한 뒤 다시 시도하세요."
      : "분석파일 인덱싱이 진행 중입니다. 잠시 후 다시 시도하세요.",
    failed.length ? "analysis_index_failed" : "analysis_index_pending",
    {
      files: blocked.slice(0, 20).map((file) => ({
        id: file.id,
        name: file.name,
        index_status: file.index_status,
        index_error: file.index_error,
      })),
    },
  );
}

async function stageFileContext(
  env: Env,
  userId: string,
  sessionId: string,
  session: AnalysisSessionRow,
  meetingMarkdown: string,
  stage: string,
  extra?: unknown
): Promise<string | null> {
  const extraText = typeof extra === "string" ? extra : extra ? JSON.stringify(extra) : "";
  const query = [
    stage,
    session.title,
    session.subject,
    session.etc_note,
    meetingMarkdown.slice(0, 2500),
    extraText.slice(0, 2500),
  ].filter(Boolean).join("\n");
  try {
    const [retrieved, graph] = await Promise.all([
      retrieveRelevantChunks(env, userId, sessionId, query, 8),
      retrieveGraphChunks(env, userId, sessionId, query, 4).catch(() => []),
    ]);
    const seen = new Set<string>();
    const hybrid = [...retrieved, ...graph].filter((chunk) => {
      if (seen.has(chunk.id)) return false;
      seen.add(chunk.id);
      return true;
    }).slice(0, 12);
    return formatRetrievedContext(hybrid);
  } catch {
    return null;
  }
}

function buildSummaryPrompt(session: AnalysisSessionRow, meetingMarkdown: string, files: AnalysisFileRow[], retrievedContext?: string | null): string {
  if (isRetrieverSearchMode(meetingMarkdown, files)) {
    return trimContext(`다음 입력에는 분석파일과 회의록이 없다. 리트리버 검색 모드로 한국어 조사 요약을 작성해줘.
반드시 JSON 객체만 출력하고, 코드펜스나 설명은 붙이지 마.

출력 형식:
{
  "overall": "검색으로 확인한 핵심 결론 2~4문장. 수치가 있으면 범위와 기준 연도를 포함",
  "summaries": [
    { "file_id": "retriever-search", "name": "리트리버 검색", "summary": "검색 질의에 대한 조사 요약", "key_points": ["핵심 수치/근거", "추정 또는 불확실성", "추가 확인 필요사항"], "sources": ["출처명 또는 URL"] }
  ]
}

규칙:
- 기대 산출물의 핵심 명사를 검색 질의로 삼아. 필요한 경우 한국어/영어 질의를 모두 고려해.
- 제조원가, 원가, BOM, 시장 규모, 법령처럼 최신성이 중요한 주제는 출처명, 발표/기사/분석 시점, 숫자의 기준을 함께 적어.
- 확정 수치와 추정치를 분리하고, 공개 근거가 부족하면 "추정" 또는 "확인 필요"라고 명시해.
- sources에는 사용한 웹 출처의 이름이나 URL을 넣어. 검색 도구가 제공되지 않았거나 출처를 확인하지 못했으면 그 한계를 key_points에 적어.

[세션 맥락]
${baseContext(session, meetingMarkdown)}

[리트리버 검색 입력]
${retrieverSearchContext(session)}`);
  }
  return trimContext(`다음 프로젝트와 자료를 한국어로 분석 준비용 요약으로 정리해줘.
반드시 JSON 객체만 출력하고, 코드펜스나 설명은 붙이지 마.

출력 형식:
{
  "overall": "자료 전체에서 보이는 핵심 맥락 2~3문장",
  "summaries": [
    { "file_id": "파일 ID 그대로", "name": "파일명", "summary": "파일별 요약 2문장 이내", "key_points": ["핵심 포인트", "수치·법령·근거 확인 필요사항"], "sources": ["file_id:chunk_id"] }
  ]
}

규칙:
- 파일에 없는 내용을 지어내지 마.
- RAG 검색 근거 청크가 제공되면 sources 배열에 사용한 file_id:chunk_id를 넣고, 핵심 포인트에도 필요한 근거 식별자를 짧게 표시해.
- 기본 목적은 특정 도메인 전용 분석이 아니라, 프로젝트·파일·주제·기대 산출물을 바탕으로 다음 분석을 설계하는 것이다.
- 원가, 회계, 정부사업, 수문조사처럼 근거가 중요한 자료에서는 숫자·단가·법령·조사 단위·근거 문구를 우선 포착해.
- 계산식이나 법령 적용이 원문만으로 불명확하면 추정하지 말고 "확인 필요"로 표시해.
- 텍스트 발췌가 없는 파일은 "텍스트 추출 불가"라고 명시하고 파일명/메모에서 추론 가능한 범위만 말해.
- summaries 배열은 입력 파일 순서를 따르고, 각 파일 ID를 정확히 유지해.

[세션 맥락]
${baseContext(session, meetingMarkdown)}

[분석 파일]
${filesContext(files, retrievedContext)}`);
}

function buildIdeasPrompt(session: AnalysisSessionRow, meetingMarkdown: string, files: AnalysisFileRow[], summaries: unknown, retrievedContext?: string | null): string {
  const noSourceRule = isRetrieverSearchMode(meetingMarkdown, files)
    ? "- 분석파일이 없으므로 검색 요약과 기대 산출물을 바탕으로 추가 확인 질문을 만들어. 출처 신뢰도, 추정 범위, 최신성 확인 관점을 포함해."
    : "- 실제 분석 방향을 정하는 데 도움이 되는 질문만 만든다.";
  return trimContext(`아래 프로젝트 맥락, 회의록, 분석 파일 요약, 연구원 메모를 바탕으로 분석 아이디어를 확장하는 객관식 질문을 만들어줘.
반드시 JSON 객체만 출력하고, 코드펜스나 설명은 붙이지 마.

출력 형식:
{
  "questions": [
    { "id": "q1", "question": "질문", "options": ["선택지1", "선택지2", "선택지3"], "rationale": "왜 이 질문이 필요한지 한 문장" }
  ]
}

규칙:
- 질문은 2~4개.
- 각 질문의 선택지는 2~4개.
- 선택지는 서로 겹치지 않게 만들어.
${noSourceRule}
- RAG 검색 근거 청크가 제공되면 rationale에 주요 근거 file_id:chunk_id를 짧게 포함해.
- 특정 도메인으로 고정하지 말고, 업로드된 프로젝트 주제에 맞춰 고객/운영/정책/재무/기술/연구 관점 중 필요한 질문을 고른다.
- 원가/회계/정부사업/수문조사 맥락이 보이면 근거자료, 법령, 수치 검증, 단순 heuristic 모델 중 무엇을 우선할지 묻는다.

[세션 맥락]
${baseContext(session, meetingMarkdown)}

[파일 목록/발췌]
${filesContext(files, retrievedContext)}

[분석파일 요약]
${JSON.stringify(summaries || {}, null, 2)}`);
}

function normalizeAnswers(value: unknown): { question: string; answer: string }[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const rec = asRecord(item);
    if (!rec) return null;
    const question = asString(rec.question);
    const answer = asString(rec.answer);
    return question && answer ? { question: question.slice(0, 220), answer: answer.slice(0, 160) } : null;
  }).filter((item): item is { question: string; answer: string } => !!item).slice(0, 8);
}

function buildPlansPrompt(
  session: AnalysisSessionRow,
  meetingMarkdown: string,
  files: AnalysisFileRow[],
  summaries: unknown,
  answers: { question: string; answer: string }[],
  retrievedContext?: string | null
): string {
  const noSourceRule = isRetrieverSearchMode(meetingMarkdown, files)
    ? "- 분석파일이 없으므로 검색 요약의 출처 재확인, 수치 범위 검증, 공식/비공식 출처 분리, 보고서 반영 단계를 포함해."
    : "- 자료에 근거한 분석 단계, 검증 지표, 산출물을 포함해.";
  return trimContext(`아래 프로젝트 자료와 사용자가 선택한 아이디어 답변을 바탕으로 실행 가능한 분석 플랜 후보를 만들어줘.
반드시 JSON 객체만 출력하고, 코드펜스나 설명은 붙이지 마.

출력 형식:
{
  "plans": [
    {
      "id": "p1",
      "title": "체크박스에 표시할 짧은 플랜명",
      "detail": "실행 방법 1문장",
      "checked": true,
      "result_contract": {
        "kind": "calculation|comparison|report|procedure|summary_decision",
        "status": "ready|needs_input|needs_evidence|needs_user_action",
        "answer": "자료에 근거한 실제 답변 또는 확인 필요 사유",
        "result_value": { "label": "결과값", "value": null, "raw_number": null, "unit": "" },
        "formula": { "expression": "수식 또는 빈 문자열", "variables": [{ "name": "변수", "value": null, "unit": "" }] },
        "comparison_rows": [],
        "report_sections": [],
        "checklist": [],
        "evidence_refs": [],
        "missing_inputs": [],
        "human_input_fields": []
      }
    }
  ]
}

규칙:
- 플랜은 4~8개.
- title은 30자 안팎으로 짧게.
- checked는 기본 추천 항목에 true를 넣어. true는 3~5개 정도.
${noSourceRule}
- 숫자나 법령을 새로 만들지 말고, 원본 파일·회의록·메모에서 확인할 수 있는 검증 절차를 먼저 배치해.
- RAG 검색 근거 청크가 제공되면 detail에 주요 근거 file_id:chunk_id를 짧게 포함해.
- result_contract에는 실제로 계산·비교·보고서·절차 중 하나의 결과 형태를 선택해.
- 원본에 없는 숫자·단가·법령·완료 사실을 만들지 말고, 값이 없거나 출처가 충돌하면 needs_input 또는 needs_evidence와 missing_inputs를 사용해.
- 계산형은 수식과 변수·단위·근거를 함께 기록하고, 보고서형은 실제 문단을 report_sections에 작성해.
- 절차형은 AI가 실제 PC나 외부 계정을 조작했다고 쓰지 말고 needs_user_action과 checklist를 사용해.
- human_input_fields에는 결과를 바꾸는 숫자·단위·기준값만 넣고 후보가 있으면 candidates에 기록해.

[세션 맥락]
${baseContext(session, meetingMarkdown)}

[파일 목록/발췌]
${filesContext(files, retrievedContext)}

[분석파일 요약]
${JSON.stringify(summaries || {}, null, 2)}

[사용자 선택 답변]
${JSON.stringify(answers, null, 2)}`);
}

function buildManualPrompt(
  session: AnalysisSessionRow,
  meetingMarkdown: string,
  files: AnalysisFileRow[],
  summaries: unknown,
  docType: "manual" | "memo",
  retrievedContext?: string | null
): string {
  const kindLabel = docType === "memo" ? "간결한 업무 메모" : "단계별 실행 매뉴얼";
  const noSourceRule = isRetrieverSearchMode(meetingMarkdown, files)
    ? "- 분석파일이 없으면 검색 결과의 출처 확인, 추정치 표시, 추가 확인 루틴을 실제 업무 절차로 써."
    : "- 회의록·메모에 실제로 나온 주제와 목적을 그대로 살려. 없는 절차를 지어내지 마.";
  return trimContext(`아래 회의록·자료·메모를 바탕으로, 분석 리포트나 검토표가 아니라 **${kindLabel}** 형태의 깔끔한 문서를 한국어로 작성해줘.
읽는 사람이 그대로 따라 하거나 공유할 수 있는 실무 문서여야 한다. "산출 상태/근거 매핑/검증표" 같은 분석 프레임은 쓰지 마.
반드시 JSON 객체만 출력하고, 코드펜스나 설명은 붙이지 마.

출력 형식:
{
  "doc_type": "${docType}",
  "title": "문서 제목",
  "purpose": "이 문서의 목적 1~2문장",
  "audience": "대상 독자 (예: 전 직원)",
  "prerequisites": ["시작 전 준비/확인 사항"],
  "steps": [
    { "title": "단계 제목", "actions": ["구체적 행동 1", "행동 2"], "screenshot_caption": "이 단계에 넣을 스크린샷 설명(선택)", "warning": "주의사항(선택)" }
  ],
  "checklist": ["완료 확인 항목"],
  "faq": [ { "q": "자주 묻는 질문", "a": "답변" } ],
  "note": "문서 하단 안내(초안 검토 요청 등)"
}

규칙:
${noSourceRule}
- steps는 실제 따라할 수 있는 순서로. 각 단계 actions는 명령형 짧은 문장.
- 스크린샷/이미지로 보충하면 좋은 지점에는 screenshot_caption 을 채워(이미지 자리 표시용).
- 위험하거나 헷갈리기 쉬운 지점에는 warning 을 넣어.
- 메모(memo) 유형이면 steps를 3~5개로 짧게, 매뉴얼(manual)이면 필요한 만큼.
- 기대 산출물/연구원 메모에 형식 지시가 있으면 우선 반영해.

[세션 맥락]
${baseContext(session, meetingMarkdown)}

[파일 목록/발췌]
${filesContext(files, retrievedContext)}

[분석파일 요약(있으면 참고)]
${JSON.stringify(summaries || {}, null, 2)}`);
}

function parseBodyObject(body: unknown): AnalysisSessionInput {
  const rec = asRecord(body);
  if (!rec) return {};
  const input: AnalysisSessionInput = {};
  if (typeof rec.title === "string") input.title = rec.title;
  if (typeof rec.date === "string") input.date = rec.date;
  if (typeof rec.subject === "string") input.subject = rec.subject;
  if (typeof rec.meetingMarkdown === "string") input.meetingMarkdown = rec.meetingMarkdown;
  if (typeof rec.etcUrl === "string") input.etcUrl = rec.etcUrl;
  if (typeof rec.etcNote === "string") input.etcNote = rec.etcNote;
  return input;
}

export function analysisInputFromBody(body: unknown): AnalysisSessionInput {
  return parseBodyObject(body);
}

async function prepareContext(env: Env, userId: string, sessionId: string, body: unknown) {
  const input = analysisInputFromBody(body);
  const session = await updateAnalysisSession(env, userId, sessionId, input);
  const meetingMarkdown = await readMeetingMarkdown(env, session);
  const files = await listAnalysisFiles(env, userId, sessionId);
  assertAnalysisFilesIndexed(files);
  return { session, meetingMarkdown, files };
}

export async function summarizeAnalysisFiles(env: Env, userId: string, sessionId: string, body: unknown, settings: AISettings) {
  const { session, meetingMarkdown, files } = await prepareContext(env, userId, sessionId, body);
  const retrievedContext = await stageFileContext(env, userId, sessionId, session, meetingMarkdown, "분석파일 요약: 핵심 맥락, 숫자, 법령, 조사 단위, 검증 필요사항");
  const prompt = buildSummaryPrompt(session, meetingMarkdown, files, retrievedContext);
  const run = await runMetered(env, userId, prompt, isRetrieverSearchMode(meetingMarkdown, files) ? forceSearchSettings(settings) : settings);
  let parsed: unknown = null;
  try { parsed = extractJson(run.out.text); } catch { parsed = null; }
  const payload = normalizeSummaryPayload(parsed, run.out.text, files);
  const dagUrl = await logStageUsage(env, userId, sessionId, "analysis_summaries", run);
  await storeOutput(env, userId, sessionId, "summaries", payload, run.out, dagUrl);
  return { session_id: sessionId, ...payload, ...meteredFields(run), dagshub_run_url: dagUrl };
}

export async function generateAnalysisIdeas(env: Env, userId: string, sessionId: string, body: unknown, settings: AISettings) {
  const { session, meetingMarkdown, files } = await prepareContext(env, userId, sessionId, body);
  const summaries = await latestOutput(env, userId, sessionId, "summaries");
  const retrievedContext = await stageFileContext(env, userId, sessionId, session, meetingMarkdown, "분석 아이디어 질문: 의사결정 관점, 검증 방향, 리스크", summaries);
  const prompt = buildIdeasPrompt(session, meetingMarkdown, files, summaries, retrievedContext);
  const run = await runMetered(env, userId, prompt, isRetrieverSearchMode(meetingMarkdown, files) ? forceSearchSettings(settings) : settings);
  let parsed: unknown = null;
  try { parsed = extractJson(run.out.text); } catch { parsed = null; }
  const payload = normalizeQuestionsPayload(parsed, run.out.text);
  const dagUrl = await logStageUsage(env, userId, sessionId, "analysis_ideas", run);
  await storeOutput(env, userId, sessionId, "ideas", payload, run.out, dagUrl);
  return { session_id: sessionId, ...payload, ...meteredFields(run), dagshub_run_url: dagUrl };
}

export async function generateAnalysisPlans(env: Env, userId: string, sessionId: string, body: unknown, settings: AISettings) {
  const { session, meetingMarkdown, files } = await prepareContext(env, userId, sessionId, body);
  const summaries = await latestOutput(env, userId, sessionId, "summaries");
  const rec = asRecord(body);
  const answers = normalizeAnswers(rec?.answers);
  const retrievedContext = await stageFileContext(env, userId, sessionId, session, meetingMarkdown, "분석 플랜: 실행 단계, 검증 지표, 산출물, 근거 매핑", { summaries, answers });
  const prompt = buildPlansPrompt(session, meetingMarkdown, files, summaries, answers, retrievedContext);
  const run = await runMetered(env, userId, prompt, isRetrieverSearchMode(meetingMarkdown, files) ? forceSearchSettings(settings) : settings);
  let parsed: unknown = null;
  try { parsed = extractJson(run.out.text); } catch { parsed = null; }
  const payload = normalizePlansPayload(parsed, run.out.text);
  const dagUrl = await logStageUsage(env, userId, sessionId, "analysis_plans", run);
  await storeOutput(env, userId, sessionId, "plans", payload, run.out, dagUrl);
  return { session_id: sessionId, ...payload, ...meteredFields(run), dagshub_run_url: dagUrl };
}

export async function generateAnalysisManual(env: Env, userId: string, sessionId: string, body: unknown, settings: AISettings) {
  const { session, meetingMarkdown, files } = await prepareContext(env, userId, sessionId, body);
  const summaries = await latestOutput(env, userId, sessionId, "summaries");
  const rec = asRecord(body);
  const docType = asString(rec?.docType || rec?.doc_type) === "memo" ? "memo" : "manual";
  const retrievedContext = await stageFileContext(env, userId, sessionId, session, meetingMarkdown, "매뉴얼/메모 문서: 목적, 단계별 절차, 준비물, 주의사항, 스크린샷 지점", { summaries, docType });
  const prompt = buildManualPrompt(session, meetingMarkdown, files, summaries, docType, retrievedContext);
  const run = await runMetered(env, userId, prompt, isRetrieverSearchMode(meetingMarkdown, files) ? forceSearchSettings(settings) : settings);
  let parsed: unknown = null;
  try { parsed = extractJson(run.out.text); } catch { parsed = null; }
  const payload = normalizeManualPayload(parsed, run.out.text, session);
  const dagUrl = await logStageUsage(env, userId, sessionId, "analysis_manual", run);
  await storeOutput(env, userId, sessionId, "manual", payload as unknown as Record<string, unknown>, run.out, dagUrl);
  return { session_id: sessionId, ...payload, ...meteredFields(run), dagshub_run_url: dagUrl };
}

function recordArray(value: unknown, max = 50): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).filter((item): item is Record<string, unknown> => !!item).slice(0, max);
}

function planResultsFromBody(body: unknown): Record<string, unknown>[] {
  const rec = asRecord(body);
  return recordArray(rec?.planResults ?? rec?.plan_results, 80);
}

function contractFromPlanResult(item: Record<string, unknown>): Record<string, unknown> {
  const contract = asRecord(item.result_contract) || asRecord(item.resultContract);
  if (!contract) return {};
  return {
    ...contract,
    human_confirmed_inputs: normalizeHumanConfirmedInputs(contract.human_confirmed_inputs || contract.humanConfirmedInputs),
  };
}

function hasReviewValue(value: unknown): boolean {
  if (typeof value === "string") return !!value.trim();
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}

function parseReviewNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replace(/[,\s원₩%]/g, "");
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function reviewNumberRange(label: string): { min: number; max: number; integer?: boolean } {
  if (/내용연수|사용\s*연한|수명|상각기간/i.test(label)) return { min: 1, max: 60, integer: true };
  if (/연도|기준\s*연도|년도/i.test(label)) return { min: 1990, max: 2100, integer: true };
  if (/부가세|vat|요율|세율|비율|보정률/i.test(label)) return { min: 0, max: 100 };
  if (/횟수|빈도|주기/i.test(label)) return { min: 0, max: 3650, integer: true };
  if (/인원|투입\s*인력/i.test(label)) return { min: 0, max: 1000, integer: true };
  if (/수량|개수|대상\s*수|지점|측점|개소|조사\s*항목|항목\s*수/i.test(label)) return { min: 0, max: 100000, integer: true };
  if (/표준\s*인.?일|인.?일|공수/i.test(label)) return { min: 0, max: 100000 };
  if (/인건비|노무비|노임/i.test(label)) return { min: 0, max: 3000000 };
  if (/단가|금액|비용|합계|예산|총액|취득가|유지보수|임대|임차|배부/i.test(label)) return { min: 0, max: 1e13 };
  return { min: -Infinity, max: Infinity };
}

function humanFieldValueIssue(field: Record<string, unknown>): string {
  const label = asString(field.label) || asString(field.id) || "담당자 입력값";
  const kind = asString(field.kind).toLowerCase();
  const value = field.value;
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (/계산\s*단위/i.test(label)) {
    if (kind !== "unit" || /\d/.test(text) || !/[가-힣a-z%]/i.test(text)) return `${label} (단위 형식 오류)`;
    return "";
  }
  if (/적용\s*장비|장비명|모델명/i.test(label)) {
    if (kind !== "text" || !/[가-힣a-z]/i.test(text)) return `${label} (장비명 확인 필요)`;
    return "";
  }
  if (kind === "boolean" && !/^(적용|미적용|예|아니오|true|false|0|1)$/i.test(text)) {
    return `${label} (적용 여부 형식 오류)`;
  }
  const numericLabel = /내용연수|사용\s*연한|상각기간|연도|단가|수량|횟수|빈도|기간|인원|시간|금액|비용|합계|예산|총액|취득가|유지보수|임대|임차|배부/i.test(label);
  if (kind !== "number" && kind !== "rate" && !numericLabel) return "";
  if (kind !== "number" && kind !== "rate") return `${label} (숫자 필드 형식 오류)`;
  const number = parseReviewNumber(value);
  if (number == null) return `${label} (숫자 형식 오류)`;
  const range = reviewNumberRange(label);
  if (number < range.min || number > range.max || (range.integer && !Number.isInteger(number))) {
    return `${label} (허용 범위 확인 필요)`;
  }
  return "";
}

function contractEvidenceIssue(contract: Record<string, unknown>, confirmedInputs: Record<string, unknown>[]): string {
  const kind = asString(contract.kind);
  const evidenceRefs = recordArray(contract.evidence_refs || contract.evidenceRefs, 20);
  const formula = asRecord(contract.formula);
  const hasFormulaEvidence = recordArray(formula?.variables, 20)
    .some((variable) => !!asString(variable.evidence || variable.source) && parseReviewNumber(variable.value) != null);
  const hasConfirmedInput = confirmedInputs.some((input) =>
    ["number", "rate"].includes(asString(input.kind))
      && hasReviewValue(input.value)
      && (input.human_verified === true || asString(input.source) === "custom")
  );
  if ((kind === "comparison" || kind === "report") && !evidenceRefs.length) return "연결된 원본 근거 없음";
  if (kind === "calculation" && !evidenceRefs.length && !hasConfirmedInput && !hasFormulaEvidence) return "계산 근거 없음";
  return "";
}

function humanConfirmationForField(
  field: Record<string, unknown>,
  confirmedInputs: Record<string, unknown>[],
): Record<string, unknown> | null {
  const keys = new Set([
    asString(field.id),
    asString(field.field_id || field.fieldId),
    asString(field.label),
  ].filter(Boolean));
  if (!keys.size) return null;
  return confirmedInputs.find((input) => [
    asString(input.field_id || input.fieldId || input.id),
    asString(input.label),
  ].some((key) => key && keys.has(key))) || null;
}

function isCandidateBackedHumanField(field: Record<string, unknown>, confirmed: Record<string, unknown> | null): boolean {
  const status = asString(field.status).toLowerCase();
  const selection = asString(field.selection).toLowerCase();
  const source = `${asString(field.source)} ${asString(confirmed?.source)}`.toLowerCase();
  return status === "selected_candidate"
    || selection.startsWith("candidate:")
    || source.includes("candidate")
    || !!asRecord(field.candidate);
}

interface ContractReviewState {
  complete: boolean;
  reasons: string[];
  missingInputs: string[];
  humanFieldIssues: string[];
}

function contractReviewState(contract: Record<string, unknown>): ContractReviewState {
  const contractStatus = asString(contract.status).toLowerCase();
  const title = asString(contract.title) || "분석 결과";
  const missingInputs = stringArray(contract.missing_inputs || contract.missingInputs, 20);
  const confirmedInputs = normalizeHumanConfirmedInputs(contract.human_confirmed_inputs || contract.humanConfirmedInputs);
  const completedStatuses = new Set(["confirmed", "custom", "verified"]);
  const humanFieldIssues = recordArray(contract.human_input_fields || contract.humanInputFields, 40)
    .filter((field) => field.required !== false)
    .map((field) => {
      const label = asString(field.label) || asString(field.id) || "담당자 입력값";
      const status = asString(field.status).toLowerCase();
      if (!completedStatuses.has(status)) return `${label} (${status || "pending"})`;
      if (!hasReviewValue(field.value)) return `${label} (값 없음)`;
      const valueIssue = humanFieldValueIssue(field);
      if (valueIssue) return valueIssue;
      const confirmed = humanConfirmationForField(field, confirmedInputs);
      if (isCandidateBackedHumanField(field, confirmed)) {
        const humanVerified = field.human_verified === true || field.humanVerified === true || confirmed?.human_verified === true;
        if (!humanVerified) return `${label} (후보 검증 필요)`;
      }
      return "";
    })
    .filter(Boolean);
  const evidenceIssue = contractEvidenceIssue(contract, confirmedInputs);
  const reasons = [
    ...(contractStatus === "ready" ? [] : [`${title} (상태: ${contractStatus || "미지정"})`]),
    ...missingInputs,
    ...humanFieldIssues,
    ...(evidenceIssue ? [`${title} (${evidenceIssue})`] : []),
  ];
  const uniqueReasons = [...new Set(reasons)].slice(0, 30);
  return {
    complete: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    missingInputs,
    humanFieldIssues,
  };
}

function pendingExecutionInputLabels(planResults: Record<string, unknown>[]): string[] {
  if (!planResults.length) return ["분석 결과 없음"];
  return [...new Set(planResults.flatMap((item) => contractReviewState(contractFromPlanResult(item)).reasons))]
    .filter(Boolean)
    .slice(0, 30);
}

function resultKindName(kind: string): string {
  if (kind === "calculation") return "계산 결과";
  if (kind === "comparison") return "비교표";
  if (kind === "report") return "보고서";
  if (kind === "procedure") return "실행 체크리스트";
  return "요약 판단";
}

function resultValueText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return asString(value);
}

function normalizePlanRun(item: Record<string, unknown>, index: number) {
  const contract = contractFromPlanResult(item);
  const resultValue = asRecord(contract.result_value);
  const title = asString(contract.title) || asString(item.title) || `검토 작업 ${index + 1}`;
  const review = contractReviewState(contract);
  const missing = review.reasons.slice(0, 20);
  const nextActions = missing.length ? missing.map((label) => `${label} 확인`) : [];
  return {
    id: asString(item.id) || `run-${index + 1}`,
    title,
    kind: asString(contract.kind) || asString(item.group) || "summary_decision",
    status: review.complete ? "success" : "needs_review",
    summary: asString(contract.answer) || asString(item.detail) || title,
    result: resultValueText(resultValue?.value) || asString(contract.answer),
    result_contract: contract,
    evidence: Array.isArray(contract.evidence_refs) ? contract.evidence_refs.slice(0, 6) : recordArray(item.evidence, 6),
    next_actions: nextActions,
    missing_inputs: missing,
    human_confirmed_inputs: normalizeHumanConfirmedInputs(contract.human_confirmed_inputs),
  };
}

function buildPlanRunsPayload(sessionId: string, planResults: Record<string, unknown>[], createdAt: string): Record<string, unknown> {
  const runs = planResults.map(normalizePlanRun);
  return {
    session_id: sessionId,
    run_count: runs.length,
    runs,
    created_at: createdAt,
  };
}

function normalizeExecutionResult(item: Record<string, unknown>, index: number) {
  const contract = contractFromPlanResult(item);
  const kind = asString(contract.kind) || asString(item.group) || "summary_decision";
  const resultValue = asRecord(contract.result_value);
  const title = asString(contract.title) || asString(item.title) || `검토 작업 ${index + 1}`;
  const review = contractReviewState(contract);
  return {
    id: asString(item.id) || `execution-${index + 1}`,
    title,
    kind,
    status: review.complete ? (kind === "calculation" ? "calculated" : "generated") : "needs_human_action",
    result: resultValueText(resultValue?.value) || asString(contract.answer) || title,
    artifact: resultKindName(kind),
    result_contract: contract,
    evidence_count: Array.isArray(contract.evidence_refs) ? contract.evidence_refs.length : 0,
    human_confirmed_inputs: normalizeHumanConfirmedInputs(contract.human_confirmed_inputs),
    review_reasons: review.reasons,
  };
}

function localAnalysisOutputMeta() {
  return {
    provider: "local",
    model: "human-input-gate",
    usage: { input_tokens: 0, output_tokens: 0 },
    cost_krw: 0,
    day_used_krw: 0,
    limit_krw: 0,
    warn_threshold_krw: 0,
    warning: null,
  };
}

export async function saveAnalysisPlanRuns(env: Env, userId: string, sessionId: string, body: unknown) {
  await requireSession(env, userId, sessionId);
  const createdAt = new Date().toISOString();
  const planResults = planResultsFromBody(body);
  const payload = buildPlanRunsPayload(sessionId, planResults, createdAt);
  await storeOutputJson(env, userId, sessionId, "plan_runs", payload, "local", "human-input-gate");
  return { ...payload, ...localAnalysisOutputMeta() };
}

export async function saveAnalysisExecutions(env: Env, userId: string, sessionId: string, body: unknown) {
  await requireSession(env, userId, sessionId);
  const rec = asRecord(body);
  const createdAt = new Date().toISOString();
  const planResults = planResultsFromBody(body);
  const pendingInputs = pendingExecutionInputLabels(planResults);
  if (pendingInputs.length) {
    throw new AnalysisError(
      409,
      "최종 보관 전에 담당자 입력·근거·실행 확인을 완료하세요.",
      "analysis_review_required",
      { blockers: pendingInputs, pending_inputs: pendingInputs },
    );
  }
  const planRuns = buildPlanRunsPayload(sessionId, planResults, createdAt);
  const executed = planResults.map(normalizeExecutionResult);
  const humanTodos = [...new Set(recordArray(planRuns.runs, 80)
    .flatMap((run) => stringArray(run.next_actions, 10))
  )].slice(0, 20);
  const payload = {
    session_id: sessionId,
    plan_runs: planRuns,
    executed,
    human_todos: humanTodos,
    artifacts: [],
    report_text_excerpt: asString(rec?.reportText || rec?.report_text).slice(0, 4000),
    created_at: createdAt,
  };
  await storeOutputJson(env, userId, sessionId, "executions", payload, "local", "human-input-gate");
  return { ...payload, ...localAnalysisOutputMeta() };
}

// 담당자 입력 다이얼로그에서 로컬 후보가 0개인 필드를 리트리버(RAG)로 보완한다.
// 청크 텍스트에서 숫자+단위를 추출해 후보 숫자로 돌려주고, 조합 단위 전개는 클라이언트가 담당한다.
interface RetrieverFieldValue {
  value: number;
  unit: string;
  excerpt: string;
  name: string;
  file_name: string;
  range: string;
  source: string;
}

// 숫자 바로 앞 텍스트에서 항목명(예: 장비명)을 뽑는다 — "X선 장비 68,117,500원" → "X선 장비".
function nameBeforeNumber(text: string, index: number): string {
  const before = text.slice(Math.max(0, index - 40), index).replace(/\s+/g, " ").trim();
  const parts = before.split(/[|,:;·\t()\[\]]+/).map((s) => s.trim()).filter(Boolean);
  const segment = parts.length ? parts[parts.length - 1] : before;
  return segment.replace(/^[\s\-–—<«.]+/, "").replace(/[\s\-–—>»]+$/, "").trim().slice(-24).trim();
}

function extractNumbersFromChunk(text: string): { value: number; unit: string; excerpt: string; name: string }[] {
  const out: { value: number; unit: string; excerpt: string; name: string }[] = [];
  const re = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(억원|천원|만원|원|명|인|일|회|개소|지점|측점|항목|시간|개월|건|개|년|월|%)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) && out.length < 40) {
    let value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    let unit = match[2] || "";
    if (unit === "만원") { value *= 10000; unit = "원"; }
    else if (unit === "억원") { value *= 100000000; unit = "원"; }
    else if (unit === "천원") { value *= 1000; unit = "원"; }
    // 단위 없는 작은 숫자(쪽번호·순번 등)는 잡음이라 제외한다.
    if (!unit && value < 1000) continue;
    if (value <= 0) continue;
    const excerpt = text.slice(Math.max(0, match.index - 24), match.index + 36).replace(/\s+/g, " ").trim();
    out.push({ value, unit, excerpt, name: nameBeforeNumber(text, match.index) });
  }
  return out;
}

export async function retrieverFieldCandidates(env: Env, userId: string, sessionId: string, body: unknown) {
  await requireSession(env, userId, sessionId);
  const rec = asRecord(body);
  const rawFields = Array.isArray(rec?.fields) ? rec.fields.slice(0, 8) : [];
  const candidates: Record<string, RetrieverFieldValue[]> = {};
  for (const raw of rawFields) {
    const field = asRecord(raw);
    const label = asString(field?.label).trim();
    if (!label) continue;
    const context = asString(field?.context).slice(0, 400);
    const query = [label, context].filter(Boolean).join(" ").slice(0, 500);
    let chunks: RetrievedChunk[] = [];
    try { chunks = await retrieveRelevantChunks(env, userId, sessionId, query, 6); } catch { chunks = []; }
    // 필드 라벨 키워드 근처에서 나온 숫자를 우선한다(파일 전체 숫자 무차별 방지).
    const labelTokens = label.toLowerCase().split(/[\s/·()]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
    const seen = new Set<string>();
    const near: RetrieverFieldValue[] = [];
    for (const chunk of chunks) {
      for (const hit of extractNumbersFromChunk(chunk.text || "")) {
        if (!labelTokens.some((token) => hit.excerpt.toLowerCase().includes(token))) continue;
        const key = `${hit.value}::${hit.unit}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const entry: RetrieverFieldValue = {
          value: hit.value,
          unit: hit.unit,
          excerpt: hit.excerpt,
          name: hit.name,
          file_name: chunk.name || "",
          range: chunk.chunk_index != null ? `청크#${chunk.chunk_index}` : "",
          source: chunk.name || "리트리버",
        };
        near.push(entry);
      }
      if (near.length >= 24) break;
    }
    // 필드명 근처에서 발견된 값만 넘긴다. 문서 전체의 무관한 숫자는 후보로 승격하지 않는다.
    candidates[label] = near.slice(0, 24);
  }
  return { candidates };
}
