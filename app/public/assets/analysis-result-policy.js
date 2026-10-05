// 분석 결과의 타입, 금액 우선순위, 담당자 입력 완결성을 한 곳에서 판단한다.
(function attachAnalysisResultPolicy(root, factory) {
  const policy = factory();
  if (typeof module === "object" && module.exports) module.exports = policy;
  if (root) root.AnalysisResultPolicy = policy;
}(typeof globalThis !== "undefined" ? globalThis : this, function createAnalysisResultPolicy() {
  "use strict";

  const RESULT_KINDS = new Set(["calculation", "comparison", "report", "procedure", "summary_decision"]);
  const FINAL_STATUSES = new Set(["ready"]);
  const COMPLETED_HUMAN_STATUSES = new Set(["confirmed", "custom", "verified"]);

  function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function resultContract(plan) {
    const source = record(plan);
    return record(source.result_contract || source.resultContract);
  }

  function resultKind(plan) {
    const kind = String(resultContract(plan).kind || "").trim();
    return RESULT_KINDS.has(kind) ? kind : "";
  }

  function inferCostSubtype(text) {
    if (/인력|인건비|노무|품셈|인.?일/i.test(text)) return "staffing";
    if (/교통|여비|출장|차량/i.test(text)) return "transport";
    if (/장비|임대|유지보수|감가|시설/i.test(text)) return "equipment";
    if (/단가|단위\s*비용|항목별|수량/i.test(text)) return "unit_cost";
    if (/주기|빈도|정기점검|횟수|조정/i.test(text)) return "frequency";
    return "cost";
  }

  function classifyPlan(input) {
    const title = String(input?.title || "");
    const detail = String(input?.detail || "");
    const text = `${title} ${detail}`;
    const seededKind = resultKind(input?.plan);
    if (seededKind === "calculation") {
      return { group: "cost", subtype: inferCostSubtype(text), label: "비용 계산", kind: seededKind, typed: true };
    }
    if (seededKind === "comparison") {
      return { group: "review", subtype: "comparison", label: "비교 검토", kind: seededKind, typed: true };
    }
    if (seededKind === "report") {
      return { group: "review", subtype: "report", label: "보고서 검토", kind: seededKind, typed: true };
    }
    if (seededKind === "procedure") {
      return { group: "checklist", subtype: "procedure", label: "담당자 실행", kind: seededKind, typed: true };
    }
    if (seededKind === "summary_decision") {
      return { group: "checklist", subtype: "summary_decision", label: "판단 검토", kind: seededKind, typed: true };
    }

    const isLaw = /법규|법령|법률|시행령|고시|규정|근거|절차|출처/i.test(text);
    const isClassification = /관측소|조사지점|대상\s*강|유형|분류|목록|확정/i.test(text);
    const isCost = /비용|원가|단가|예산|금액|합계|산출|산정|계산|인건비|교통비|장비|임대|유지보수|품셈|인.?일|빈도|주기|조정/i.test(text);
    if (isLaw) return { group: "review", subtype: "law", label: "법규 검토", kind: "report", typed: false };
    if (isCost) return { group: "cost", subtype: inferCostSubtype(text), label: "비용 계산", kind: "calculation", typed: false };
    if (isClassification) return { group: "checklist", subtype: "classification", label: "대상 분류", kind: "summary_decision", typed: false };
    return { group: "checklist", subtype: "manual", label: "사람 확인", kind: "summary_decision", typed: false };
  }

  function parseManualNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = raw.replace(/[,\s원₩%]/g, "");
    if (!normalized || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function fieldRange(label) {
    const field = String(label || "");
    if (/내용연수|사용\s*연한|수명|상각기간/i.test(field)) return { min: 1, max: 60, integer: true };
    if (/연도|기준\s*연도|년도/i.test(field)) return { min: 1990, max: 2100, integer: true };
    if (/부가세|vat|요율|세율|비율|보정률/i.test(field)) return { min: 0, max: 100 };
    if (/횟수|빈도|주기/i.test(field)) return { min: 0, max: 3650, integer: true };
    if (/인원|투입\s*인력/i.test(field)) return { min: 0, max: 1000, integer: true };
    if (/수량|개수|대상\s*수|지점|측점|개소|조사\s*항목|항목\s*수/i.test(field)) return { min: 0, max: 100000, integer: true };
    if (/표준\s*인.?일|인.?일|공수/i.test(field)) return { min: 0, max: 100000 };
    if (/인건비|노무비|노임/i.test(field)) return { min: 0, max: 3000000 };
    if (/단가|금액|비용|합계|예산|총액|취득가|유지보수|임대|임차|배부/i.test(field)) return { min: 0, max: 1e13 };
    return { min: -Infinity, max: Infinity };
  }

  function validNumberForField(label, value) {
    const number = parseManualNumber(value);
    if (number == null) return false;
    const range = fieldRange(label);
    if (number < range.min || number > range.max) return false;
    return !range.integer || Number.isInteger(number);
  }

  function isHumanFieldResolved(field) {
    const source = record(field);
    if (source.required === false && !String(source.value ?? "").trim()) return true;
    if (source.status === "excluded") return source.required === false;
    if (!COMPLETED_HUMAN_STATUSES.has(String(source.status || ""))) return false;
    const value = String(source.value ?? "").trim();
    if (!value) return false;
    if (source.source === "candidate" && source.human_verified !== true) return false;
    if (source.kind === "number" || source.kind === "rate") return validNumberForField(source.label, value);
    if (source.kind === "boolean") return /^(적용|미적용|예|아니오|true|false|0|1)$/i.test(value);
    if (source.kind === "unit") return !/\d/.test(value) && /[가-힣a-z%]/i.test(value);
    if (/적용\s*장비|장비명|모델명/i.test(String(source.label || ""))) return /[가-힣a-z]/i.test(value);
    if (/내용연수|사용\s*연한|상각기간|연도|단가|수량|횟수|빈도|기간|인원|시간|금액|비용|합계|예산|총액|취득가|유지보수|임대|임차|배부/i.test(String(source.label || ""))) return false;
    return true;
  }

  function resolvedFields(fields) {
    return (Array.isArray(fields) ? fields : []).filter(isHumanFieldResolved);
  }

  function fieldNumber(fields, pattern) {
    const field = fields.find((entry) => pattern.test(String(entry.label || "")));
    return field ? parseManualNumber(field.value) : null;
  }

  function manualAmount(input) {
    const fields = resolvedFields(input?.fields);
    if (!fields.length) return null;
    const subtype = String(input?.subtype || "cost");
    const explicitTotal = fieldNumber(fields, /총\s*(액|비용|금액)|최종\s*(금액|비용)|합계/i);
    if (explicitTotal != null) return explicitTotal;

    if (subtype === "equipment") {
      const acquisition = fieldNumber(fields, /취득가|장비\s*(가격|금액)|구매\s*가격/i);
      const usefulLife = fieldNumber(fields, /내용연수|상각기간|사용\s*연한|수명/i);
      if (acquisition == null || usefulLife == null || usefulLife < 1 || usefulLife > 60) return null;
      const combined = fieldNumber(fields, /유지보수.*(?:임대|임차)|(?:임대|임차).*유지보수/i);
      const maintenance = combined == null ? fieldNumber(fields.filter((field) => !/(?:임대|임차)/i.test(String(field.label || ""))), /유지보수/i) : null;
      const rental = combined == null ? fieldNumber(fields.filter((field) => !/유지보수/i.test(String(field.label || ""))), /임대비|임차료/i) : null;
      return acquisition / usefulLife + (combined ?? 0) + (maintenance ?? 0) + (rental ?? 0);
    }

    const unitPrice = fieldNumber(fields, /단가|unit\s*price|price/i);
    const quantity = fieldNumber(fields, /대상\s*수량|수량|개수|항목\s*수|qty|quantity/i);
    if (subtype === "unit_cost") return unitPrice != null && quantity != null ? unitPrice * quantity : null;

    if (subtype === "staffing") {
      const sites = fieldNumber(fields, /강\/지점\s*수|지점\s*수|개소\s*수|대상\s*수/i);
      const items = fieldNumber(fields, /조사\s*항목\s*수|항목\s*수/i);
      const effort = fieldNumber(fields, /표준\s*인.?일|공수/i);
      const labor = fieldNumber(fields, /인건비\s*단가|노무비\s*단가|노임/i);
      return [sites, items, effort, labor].every((value) => value != null)
        ? sites * items * effort * labor
        : null;
    }

    if (subtype === "transport") {
      const sites = fieldNumber(fields, /지점\s*수|개소\s*수|대상\s*수/i);
      const fare = fieldNumber(fields, /왕복\s*교통비|교통비|여비/i);
      const frequency = fieldNumber(fields, /연간\s*조사\s*빈도|빈도|횟수/i);
      return [sites, fare, frequency].every((value) => value != null) ? sites * fare * frequency : null;
    }

    if (subtype === "frequency") {
      const baseCost = fieldNumber(fields, /기본\s*비용|조정\s*대상\s*비용/i);
      const baseFrequency = fieldNumber(fields, /기준\s*빈도/i);
      const appliedFrequency = fieldNumber(fields, /적용\s*빈도/i);
      return [baseCost, baseFrequency, appliedFrequency].every((value) => value != null) && baseFrequency > 0
        ? baseCost * appliedFrequency / baseFrequency
        : null;
    }

    if (unitPrice != null && quantity != null) {
      const multipliers = fields
        .filter((field) => /(빈도|횟수|기간|인원|시간)/i.test(String(field.label || "")))
        .map((field) => parseManualNumber(field.value))
        .filter((value) => value != null);
      return unitPrice * quantity * multipliers.reduce((product, value) => product * value, 1);
    }
    return null;
  }

  function authoritativePlanAmount(plan) {
    const contract = resultContract(plan);
    if (contract.kind !== "calculation" || contract.status !== "ready") return null;
    const result = record(contract.result_value || contract.resultValue);
    const raw = parseManualNumber(result.raw_number);
    if (raw != null) return raw;
    return parseManualNumber(result.value);
  }

  function aggregateRowAmount(rows) {
    const source = Array.isArray(rows) ? rows : [];
    const totals = source.filter((row) => /합계|총계|총\s*(금액|비용)|grand\s*total|amount[_\s-]*total/i.test(
      `${row?.sourceRole || ""} ${row?.label || ""} ${row?.rowHeader || ""} ${row?.columnHeader || ""}`
    ));
    const candidates = totals.length ? totals : (source.length === 1 ? source : []);
    const values = [...new Set(candidates.map((row) => parseManualNumber(row?.value)).filter((value) => value != null))];
    return values.length === 1 ? values[0] : null;
  }

  function selectEffectiveAmount(input) {
    const authoritative = parseManualNumber(input?.authoritative);
    if (authoritative != null) return authoritative;
    const manual = parseManualNumber(input?.manual);
    if (manual != null) return manual;
    return parseManualNumber(input?.fallback);
  }

  function summarizeCosts(items) {
    const eligible = (Array.isArray(items) ? items : []).filter((item) => item?.eligible !== false && item?.kind === "calculation");
    const confirmed = eligible.filter((item) => item.ready === true && parseManualNumber(item.amount) != null);
    const total = confirmed.reduce((sum, item) => sum + parseManualNumber(item.amount), 0);
    const pendingCount = eligible.length - confirmed.length;
    return {
      total: confirmed.length ? total : null,
      confirmedCount: confirmed.length,
      pendingCount,
      itemCount: eligible.length,
      isFinal: eligible.length > 0 && pendingCount === 0,
    };
  }

  function contractBlockers(contracts) {
    return (Array.isArray(contracts) ? contracts : []).flatMap((raw, index) => {
      const contract = record(raw);
      const title = String(contract.title || `검토 작업 ${index + 1}`);
      const blockers = [];
      if (!FINAL_STATUSES.has(String(contract.status || ""))) blockers.push(`${title}: ${contract.status || "상태 미확정"}`);
      const missing = Array.isArray(contract.missing_inputs) ? contract.missing_inputs.filter(Boolean) : [];
      if (missing.length) blockers.push(`${title}: ${missing.slice(0, 3).join(", ")}`);
      const fields = Array.isArray(contract.human_input_fields) ? contract.human_input_fields : [];
      const pending = fields.filter((field) => field?.required !== false && !isHumanFieldResolved(field));
      if (pending.length) blockers.push(`${title}: ${pending.slice(0, 3).map((field) => field.label || "필수 입력").join(", ")}`);
      const evidenceRefs = Array.isArray(contract.evidence_refs) ? contract.evidence_refs.filter(Boolean) : [];
      const confirmedInputs = Array.isArray(contract.human_confirmed_inputs)
        ? contract.human_confirmed_inputs.filter((input) => {
            const value = String(input?.value ?? "").trim();
            return ["number", "rate"].includes(String(input?.kind || ""))
              && value
              && (input?.human_verified === true || input?.source === "custom");
          })
        : [];
      const formulaVariables = Array.isArray(contract.formula?.variables) ? contract.formula.variables : [];
      const hasFormulaEvidence = formulaVariables.some((variable) =>
        String(variable?.evidence || variable?.source || "").trim() && parseManualNumber(variable?.value) != null
      );
      if (["comparison", "report"].includes(String(contract.kind || "")) && !evidenceRefs.length) {
        blockers.push(`${title}: 연결된 원본 근거 없음`);
      }
      if (contract.kind === "calculation" && !evidenceRefs.length && !confirmedInputs.length && !hasFormulaEvidence) {
        blockers.push(`${title}: 계산 근거 없음`);
      }
      return blockers;
    });
  }

  function reportReadiness(contracts, stored) {
    const list = Array.isArray(contracts) ? contracts : [];
    if (!list.length) return { state: "waiting", label: "대기", blockers: [] };
    const blockers = contractBlockers(list);
    if (blockers.length) return { state: "needs_review", label: "검토 필요", blockers };
    if (stored) return { state: "stored", label: "서버 기록됨", blockers: [] };
    return { state: "ready", label: "확정 가능", blockers: [] };
  }

  return {
    RESULT_KINDS,
    aggregateRowAmount,
    authoritativePlanAmount,
    classifyPlan,
    contractBlockers,
    fieldRange,
    isHumanFieldResolved,
    manualAmount,
    parseManualNumber,
    reportReadiness,
    resultKind,
    selectEffectiveAmount,
    summarizeCosts,
    validNumberForField,
  };
}));
