const test = require("node:test");
const assert = require("node:assert/strict");

const policy = require("../public/assets/analysis-result-policy.js");

function numberField(label, value, overrides = {}) {
  return {
    label,
    value,
    kind: "number",
    status: "confirmed",
    required: true,
    ...overrides,
  };
}

test("blank values stay null while an explicit zero is preserved", () => {
  for (const value of [null, undefined, "", "   ", "원", "not-a-number"]) {
    assert.equal(policy.parseManualNumber(value), null);
  }

  assert.equal(policy.parseManualNumber(0), 0);
  assert.equal(policy.parseManualNumber("0"), 0);
  assert.equal(policy.parseManualNumber("0원"), 0);
  assert.equal(policy.selectEffectiveAmount({ authoritative: 0, manual: 12, fallback: 30 }), 0);
  assert.equal(policy.manualAmount({
    subtype: "cost",
    fields: [numberField("최종 금액", 0)],
  }), 0);
});

test("a typed comparison is never reclassified or aggregated as a cost", () => {
  const plan = {
    result_contract: {
      kind: "comparison",
      status: "ready",
      result_value: { raw_number: 136235000, value: "136,235,000원" },
    },
  };
  const classification = policy.classifyPlan({
    title: "구매 원가와 단가 비교",
    detail: "총 금액 차이를 계산",
    plan,
  });

  assert.deepEqual(classification, {
    group: "review",
    subtype: "comparison",
    label: "비교 검토",
    kind: "comparison",
    typed: true,
  });
  assert.equal(policy.authoritativePlanAmount(plan), null);

  const summary = policy.summarizeCosts([
    { kind: "calculation", amount: 810305000, ready: true },
    { kind: "comparison", amount: 136235000, ready: true },
  ]);
  assert.equal(summary.total, 810305000);
  assert.equal(summary.itemCount, 1);
  assert.equal(summary.isFinal, true);
});

test("equipment cost adds a combined maintenance/rental field once", () => {
  const amount = policy.manualAmount({
    subtype: "equipment",
    fields: [
      numberField("장비 취득가", 60000000),
      numberField("내용연수", 5),
      numberField("유지보수 및 임대비", 3000000),
    ],
  });

  assert.equal(amount, 15000000);
});

test("equipment cost rejects an invalid useful life instead of treating a year as a divisor", () => {
  const fields = [
    numberField("장비 취득가", 68117500),
    numberField("내용연수", 2026),
    numberField("유지보수비", 21945000),
  ];

  assert.equal(policy.validNumberForField("내용연수", 2026), false);
  assert.equal(policy.manualAmount({ subtype: "equipment", fields }), null);
});

test("unrelated numeric fields are not multiplied as a fallback formula", () => {
  const amount = policy.manualAmount({
    subtype: "cost",
    fields: [
      numberField("검토 기준값 A", 2026),
      numberField("검토 기준값 B", 40000000),
      numberField("검토 기준값 C", 21945000),
    ],
  });

  assert.equal(amount, null);
});

test("the authoritative 810,305,000 total wins over supporting values", () => {
  const plan = {
    result_contract: {
      kind: "calculation",
      status: "ready",
      result_value: {
        label: "구매 총액",
        raw_number: 810305000,
        value: "810,305,000원",
        unit: "원",
      },
    },
  };

  assert.equal(policy.authoritativePlanAmount(plan), 810305000);
  assert.equal(policy.selectEffectiveAmount({
    authoritative: policy.authoritativePlanAmount(plan),
    manual: 43923621.668,
    fallback: 136235000,
  }), 810305000);
  assert.equal(policy.aggregateRowAmount([
    { label: "구매 총 금액", sourceRole: "amount_total", value: 810305000 },
    { label: "비교 후보", value: 136235000 },
  ]), 810305000);
});

test("cost aggregation distinguishes a partial subtotal from a final total", () => {
  const partial = policy.summarizeCosts([
    { kind: "calculation", amount: 810305000, ready: true },
    { kind: "calculation", amount: null, ready: false },
    { kind: "comparison", amount: 136235000, ready: true },
  ]);
  assert.deepEqual(partial, {
    total: 810305000,
    confirmedCount: 1,
    pendingCount: 1,
    itemCount: 2,
    isFinal: false,
  });

  const final = policy.summarizeCosts([
    { kind: "calculation", amount: 810305000, ready: true },
    { kind: "calculation", amount: 0, ready: true },
    { kind: "comparison", amount: 136235000, ready: true },
  ]);
  assert.deepEqual(final, {
    total: 810305000,
    confirmedCount: 2,
    pendingCount: 0,
    itemCount: 2,
    isFinal: true,
  });
});

test("a retrieved candidate is unresolved until a person verifies it", () => {
  const candidate = numberField("구매 총액", 810305000, {
    source: "candidate",
    status: "confirmed",
    human_verified: false,
  });
  assert.equal(policy.isHumanFieldResolved(candidate), false);
  assert.equal(policy.manualAmount({ subtype: "cost", fields: [candidate] }), null);

  const verified = { ...candidate, human_verified: true };
  assert.equal(policy.isHumanFieldResolved(verified), true);
  assert.equal(policy.manualAmount({ subtype: "cost", fields: [verified] }), 810305000);
});

test("legacy equipment and calculation-unit mappings require a new confirmation", () => {
  assert.equal(policy.isHumanFieldResolved({
    label: "적용 장비",
    kind: "text",
    value: "68117500",
    status: "confirmed",
    required: true,
  }), false);
  assert.equal(policy.isHumanFieldResolved({
    label: "계산 단위",
    kind: "unit",
    value: "2원/1인1일",
    status: "confirmed",
    required: true,
  }), false);
  assert.equal(policy.isHumanFieldResolved({
    label: "내용연수",
    kind: "text",
    value: "2026",
    status: "confirmed",
    required: true,
  }), false);
  assert.equal(policy.isHumanFieldResolved({
    label: "계산 단위",
    kind: "unit",
    value: "원/인·일",
    status: "custom",
    required: true,
  }), true);
});

test("ready report and calculation contracts still require traceable evidence", () => {
  const blocked = policy.contractBlockers([
    { kind: "report", title: "비교 보고서", status: "ready" },
    { kind: "calculation", title: "구매 총액", status: "ready" },
  ]);
  assert.ok(blocked.some((item) => item.includes("연결된 원본 근거 없음")));
  assert.ok(blocked.some((item) => item.includes("계산 근거 없음")));

  assert.deepEqual(policy.contractBlockers([{
    kind: "calculation",
    title: "구매 총액",
    status: "ready",
    evidence_refs: [{ file_name: "구매계획.xlsx", sheet: "계획", range: "F20" }],
  }]), []);
});

test("report readiness exposes every finalization blocker", () => {
  assert.deepEqual(policy.reportReadiness([], false), {
    state: "waiting",
    label: "대기",
    blockers: [],
  });

  const blocked = policy.reportReadiness([
    { title: "입력 항목", status: "needs_input", missing_inputs: ["수량"] },
    { title: "근거 항목", status: "needs_evidence" },
    { title: "실행 항목", status: "needs_user_action" },
    {
      title: "후보 검증",
      status: "ready",
      human_input_fields: [numberField("단가", 210000, {
        source: "candidate",
        human_verified: false,
      })],
    },
  ], false);

  assert.equal(blocked.state, "needs_review");
  assert.equal(blocked.label, "검토 필요");
  assert.ok(blocked.blockers.some((item) => item.includes("needs_input")));
  assert.ok(blocked.blockers.some((item) => item.includes("수량")));
  assert.ok(blocked.blockers.some((item) => item.includes("needs_evidence")));
  assert.ok(blocked.blockers.some((item) => item.includes("needs_user_action")));
  assert.ok(blocked.blockers.some((item) => item.includes("단가")));
});

test("a fully verified report becomes ready and then stored", () => {
  const contracts = [{
    title: "구매 총액",
    status: "ready",
    missing_inputs: [],
    human_input_fields: [numberField("최종 금액", 810305000, {
      source: "candidate",
      human_verified: true,
    })],
  }];

  assert.deepEqual(policy.reportReadiness(contracts, false), {
    state: "ready",
    label: "확정 가능",
    blockers: [],
  });
  assert.deepEqual(policy.reportReadiness(contracts, true), {
    state: "stored",
    label: "서버 기록됨",
    blockers: [],
  });
});
