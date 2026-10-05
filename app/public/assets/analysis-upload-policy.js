// 분석파일 업로드의 크기·개수 한도를 서버(src/domains/analysis/analysis.ts)와 같은 값으로 판단한다.
// 브라우저가 한 번에 수십 MB를 던져 413(HTTP 페이로드 초과)으로 끝나는 대신,
// 업로드 전에 파일별 처리 방법(그대로/앞부분 발췌/거부)과 요청 분할 묶음을 결정한다.
(function attachAnalysisUploadPolicy(root, factory) {
  const policy = factory();
  if (typeof module === "object" && module.exports) module.exports = policy;
  if (root) root.AnalysisUploadPolicy = policy;
}(typeof globalThis !== "undefined" ? globalThis : this, function createAnalysisUploadPolicy() {
  "use strict";

  // 서버 상수와 1:1로 맞춘다. 서버가 바뀌면 여기도 함께 바꿔야 한다.
  const LIMITS = {
    maxFileBytes: 6 * 1024 * 1024,
    maxUploadBytes: 15 * 1024 * 1024,
    maxFilesPerSession: 15,
  };
  // 서버는 텍스트 발췌를 12,000자까지만 보관하므로, 앞부분 512KB면 발췌 품질이 동일하다.
  const TEXT_HEAD_BYTES = 512 * 1024;
  // 클라이언트가 뽑은 PDF/엑셀 텍스트는 6만 자 상한이라 요청 크기 계산 시 넉넉히 이 값으로 잡는다.
  const CLIENT_EXCERPT_BYTES = 256 * 1024;

  const TEXT_EXT_RE = /\.(txt|md|csv|tsv|json|jsonl|vtt|srt|log|xml|html|css|js|ts|tsx|jsx|py|sql)$/i;

  function fmtBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  // 서버 isLikelyText 와 같은 판정 — 서버가 원본 바이트를 그대로 디코딩해 발췌를 만드는 형식.
  function isTextLike(name, type) {
    const mime = String(type || "").toLowerCase();
    if (/officedocument|opendocument|ms-excel|ms-powerpoint|msword|application\/zip|octet-stream|pdf/.test(mime)) return false;
    return mime.startsWith("text/")
      || /\b(json|csv|xml|javascript|typescript|yaml|markdown)\b/.test(mime)
      || TEXT_EXT_RE.test(String(name || ""));
  }

  function isPdf(name, type) {
    return /\.pdf$/i.test(String(name || "")) || /pdf/i.test(String(type || ""));
  }

  function isSpreadsheet(name, type) {
    return /\.(xlsx|xls|csv)$/i.test(String(name || "")) || /spreadsheet|excel|csv/i.test(String(type || ""));
  }

  // 파일 하나를 어떻게 보낼지 결정한다.
  // - keep:           원본 그대로 업로드
  // - text_head:      한도 초과 텍스트 → 앞부분만 잘라서 업로드(서버 발췌 결과는 원본과 동일)
  // - client_excerpt: 한도 초과 PDF/엑셀 → 브라우저가 추출한 텍스트만 .excerpt.txt 로 업로드
  // - reject:         발췌할 방법이 없는 한도 초과 파일
  function classifyFile(file, limits) {
    const max = (limits || LIMITS).maxFileBytes;
    const name = String(file?.name || "analysis-file");
    const size = Number(file?.size) || 0;
    const type = String(file?.type || "");
    if (size <= max) return { name, size, type, action: "keep", uploadBytes: size, note: "" };
    if (isTextLike(name, type)) {
      return {
        name,
        size,
        type,
        action: "text_head",
        uploadBytes: Math.min(TEXT_HEAD_BYTES, size),
        note: `${fmtBytes(size)} 텍스트 파일이라 앞부분 ${fmtBytes(TEXT_HEAD_BYTES)}만 등록했습니다(서버 발췌 12,000자 기준으로는 원본과 동일).`,
      };
    }
    if (isPdf(name, type) || isSpreadsheet(name, type)) {
      return {
        name,
        size,
        type,
        action: "client_excerpt",
        uploadBytes: CLIENT_EXCERPT_BYTES,
        note: `${fmtBytes(size)} 파일이라 원본 대신 브라우저에서 추출한 텍스트만 등록했습니다.`,
      };
    }
    return {
      name,
      size,
      type,
      action: "reject",
      uploadBytes: 0,
      note: `${name}: ${fmtBytes(size)} — 파일 하나는 ${fmtBytes(max)}까지만 등록할 수 있고, 이 형식은 텍스트 발췌도 만들 수 없습니다.`,
    };
  }

  // 업로드 계획: 파일별 처리 방법 + 요청당 maxUploadBytes 를 넘지 않는 묶음.
  function planUpload(files, options) {
    const limits = { ...LIMITS, ...(options?.limits || {}) };
    const alreadyUploaded = Number(options?.alreadyUploaded) || 0;
    const list = Array.from(files || []);
    const entries = list.map((file, index) => ({ index, ...classifyFile(file, limits) }));
    const rejected = entries.filter((entry) => entry.action === "reject");
    const accepted = entries.filter((entry) => entry.action !== "reject");

    const errors = rejected.map((entry) => entry.note);
    if (alreadyUploaded + accepted.length > limits.maxFilesPerSession) {
      errors.push(`분석 세션 하나에는 파일을 최대 ${limits.maxFilesPerSession}개까지 등록할 수 있습니다(현재 ${alreadyUploaded}개 + 신규 ${accepted.length}개).`);
    }

    const batches = [];
    let current = [];
    let currentBytes = 0;
    for (const entry of accepted) {
      const bytes = Math.max(1, entry.uploadBytes);
      if (current.length && currentBytes + bytes > limits.maxUploadBytes) {
        batches.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(entry);
      currentBytes += bytes;
    }
    if (current.length) batches.push(current);

    return { entries, accepted, rejected, batches, errors, limits };
  }

  return {
    LIMITS,
    TEXT_HEAD_BYTES,
    CLIENT_EXCERPT_BYTES,
    fmtBytes,
    isTextLike,
    isPdf,
    isSpreadsheet,
    classifyFile,
    planUpload,
  };
}));
