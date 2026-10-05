import { describe, expect, it } from "vitest";
import { findCurrencyAmounts } from "../src/domains/nblog";

/**
 * #191 — 협찬 고지와 결제 금액을 함께 노출하지 않는다. 프롬프트로 막지만 새어나갈 수
 * 있어 후처리로 확인한다. v7 초안에 실제로 나갔던 문장을 회귀 기준으로 삼는다.
 */
describe("결제 금액 검출 (#191)", () => {
  it("v7 에 나갔던 영수증 문장을 잡는다", () => {
    const body = "항목은 짬뽕탕 19,000 / 500cc 4,600 ×2 = 9,200 / 수박세트 12,900, 합계 금액 41,100이 찍혀 있었다.";

    const found = findCurrencyAmounts(body);

    expect(found).toEqual(expect.arrayContaining(["19,000", "4,600", "9,200", "12,900", "41,100"]));
  });

  it("'원' 이 붙은 금액도 잡는다", () => {
    expect(findCurrencyAmounts("짬뽕탕 19000원을 주문했다")).toContain("19000원");
    expect(findCurrencyAmounts("합계 41,100원")).toEqual(expect.arrayContaining(["41,100원"]));
  });

  it("메뉴명만 있는 문장은 잡지 않는다", () => {
    const body = "짬뽕탕과 수박세트를 주문했다. 테라 생맥주 두 잔이 함께 나왔다.";

    expect(findCurrencyAmounts(body)).toEqual([]);
  });

  it("날짜·시각은 금액으로 보지 않는다", () => {
    const body = "2026-07-12 저녁에 방문했다. 영업시간은 17:00~20:00이다.";

    expect(findCurrencyAmounts(body)).toEqual([]);
  });

  it("주소의 번지수는 금액으로 보지 않는다", () => {
    expect(findCurrencyAmounts("권선동 1016-15")).toEqual([]);
  });

  it("중복은 한 번만 보고한다", () => {
    expect(findCurrencyAmounts("19,000 그리고 또 19,000")).toEqual(["19,000"]);
  });
});
