import { describe, expect, it } from "vitest";
import { checkDraftQuality } from "../src/domains/nblog";

/**
 * #173 — 검증기 역할 재정의.
 *
 * 자리표시자 개수를 세던 것에서 **발행 규격과 검증 가능한 사실**을 보는 쪽으로 옮긴다.
 * 감상·분위기 표현은 사람이 확인 후 발행하므로 막지 않는다(#189). 반면 협찬 표기
 * 누락이나 사진 표시 개수 불일치는 사람이 눈으로 세기 어렵다.
 */
const DISCLOSURE = "이 글은 업체로부터 서비스를 제공받아 솔직하게 작성한 후기입니다.";

const goodDraft = [
  "# 인계동술집 미생맥주 방문기",
  "",
  DISCLOSURE,
  "",
  "## 가게 앞에서",
  "인계동술집을 찾아 미생맥주로 향했어요. ".repeat(20),
  "[VIDEO:001]",
  "",
  "## 첫 잔",
  "미생맥주에서 시원한 첫 잔을 받았습니다. 인계동술집 분위기가 좋네요. 미생맥주 추천합니다. ".repeat(20),
  "[IMAGE:002]",
  "",
  "#미생맥주 #인계동술집 #수원맛집 #권선동술집 #체험단후기 #수원시청역술집 #권선동맥주 #인계동가성비술집 #권선동맛집 #미생맥주수원권선점",
].join("\n");

const context = { mediaCount: 2, requirements: "필수 키워드: 인계동술집 3회, 미생맥주 3회", sponsorDisclosure: DISCLOSURE };
const rules = (draft: string, over = {}) => checkDraftQuality(draft, { ...context, ...over }).map((c) => c.rule);

describe("발행 규격 검증 (#173)", () => {
  it("규격을 갖춘 초안은 경고하지 않는다", () => {
    expect(rules(goodDraft)).toEqual([]);
  });

  it("협찬 표기가 빠지면 failed 로 잡는다", () => {
    const without = goodDraft.replace(DISCLOSURE, "");

    const found = checkDraftQuality(without, context).find((c) => c.rule === "sponsor_disclosure_missing");

    expect(found).toBeDefined();
    // 법적 필수 항목이라 경고가 아니라 실패다.
    expect(found?.status).toBe("failed");
  });

  it("사진 표시가 올린 개수보다 적으면 알린다", () => {
    expect(rules(goodDraft, { mediaCount: 7 })).toContain("image_marker_missing");
  });

  /**
   * staging v9 회귀: 영상 6개 + 사진 1장을 올렸는데 본문에 [VIDEO:002]~[VIDEO:011] 이
   * 나왔다. 프레임 수(11)와 표시 수(11)를 비교하던 탓에 통과했지만, 사용자가
   * 스마트에디터에 넣을 파일은 7개라 자리를 맞출 수 없었다.
   */
  it("올린 파일에 없는 번호를 가리키면 failed 로 잡는다", () => {
    const tooMany = [
      "# 제목", "", DISCLOSURE, "", "## 한 잔",
      "인계동술집 미생맥주 인계동술집 미생맥주 인계동술집 미생맥주 좋았어요. ".repeat(40),
      "[IMAGE:001]", "[VIDEO:002]", "[VIDEO:003]", "[VIDEO:011]",
      "#가 #나 #다 #라 #마 #바 #사 #아 #자 #차",
    ].join("\n");

    const found = checkDraftQuality(tooMany, { ...context, mediaCount: 7 })
      .find((check) => check.rule === "media_marker_out_of_range");

    expect(found?.status).toBe("failed");
    expect(found?.message).toContain("11");
  });

  it("파일 수 안의 번호만 쓰면 통과한다", () => {
    const exact = [
      "# 제목", "", DISCLOSURE, "", "## 한 잔",
      "인계동술집 미생맥주 인계동술집 미생맥주 인계동술집 미생맥주 좋았어요. ".repeat(40),
      "[IMAGE:001]", "[VIDEO:002]",
      "#가 #나 #다 #라 #마 #바 #사 #아 #자 #차",
    ].join("\n");

    expect(rules(exact)).toEqual([]);
  });

  it("본문에 네이버 지도·플레이스 링크가 있으면 알린다", () => {
    // 날링크는 스마트에디터에서 장소 카드로 안 바뀌어 텍스트 링크로만 남는다.
    // 장소는 발행 화면의 장소 버튼으로 넣는다.
    for (const url of ["https://naver.me/FDjil0KT", "https://map.naver.com/p/xxx", "https://m.place.naver.com/restaurant/1"]) {
      const withLink = goodDraft.replace("[VIDEO:001]", `플레이스는 여기: ${url}\n[VIDEO:001]`);
      expect(rules(withLink), url).toContain("place_link_in_body");
    }
  });

  it("링크 없는 정상 초안은 place_link_in_body 를 내지 않는다", () => {
    expect(rules(goodDraft)).not.toContain("place_link_in_body");
  });

  it("해시태그가 10개 미만이면 알린다", () => {
    const fewTags = goodDraft.replace(/^#미생맥주 .*$/m, "#미생맥주 #인계동술집");

    expect(rules(fewTags)).toContain("tag_count_low");
  });

  it("소제목이 없으면 알린다", () => {
    expect(rules(goodDraft.replace(/^## .*$/gm, ""))).toContain("heading_missing");
  });

  it("요구사항의 필수 키워드 횟수가 모자라면 알린다", () => {
    const short = [
      "# 제목", "", DISCLOSURE, "", "## 어느 저녁",
      "좋은 곳이었어요. ".repeat(80),
      "[VIDEO:001]", "[IMAGE:002]",
      "#가 #나 #다 #라 #마 #바 #사 #아 #자 #차",
    ].join("\n");

    const found = rules(short);

    expect(found).toContain("required_keyword_short");
  });

  it("본문이 짧으면 알린다", () => {
    const short = [
      "# 제목", "", DISCLOSURE, "", "## 짧은 글", "짧아요.", "[VIDEO:001]", "[IMAGE:002]",
      "#가 #나 #다 #라 #마 #바 #사 #아 #자 #차",
    ].join("\n");

    expect(rules(short)).toContain("body_length_short");
  });

  /**
   * staging v9 회귀: '# 미생맥주 방문 정리', '# 한줄평', '# 해시태그' 를 큰 제목으로 달았다.
   * 폐지하려던 고정 섹션이 형태만 바꿔 돌아온 것이고(#172), '해시태그' 라는 제목이
   * 블로그에 그대로 노출되면 어색하다.
   */
  it("글 제목 말고 큰 제목이 더 있으면 알린다", () => {
    const withSections = `${goodDraft}\n\n# 한줄평\n좋았습니다.\n\n# 해시태그\n#미생맥주`;

    const found = checkDraftQuality(withSections, context).find((c) => c.rule === "extra_h1_heading");

    expect(found).toBeDefined();
    expect(found?.message).toContain("한줄평");
    expect(found?.message).toContain("해시태그");
  });

  it("해시태그 줄은 큰 제목으로 세지 않는다", () => {
    // 태그 줄은 # 뒤에 공백이 없어 제목과 구분된다.
    expect(rules(goodDraft)).not.toContain("extra_h1_heading");
  });

  it("감상 표현은 검증 대상이 아니다", () => {
    // #189 정정 — 주관적 서술은 사람이 확인 후 발행하므로 막지 않는다.
    const withFeelings = goodDraft.replace("분위기가 좋네요", "아늑하고 시원했어요. 직원분도 친절하셨습니다");

    expect(rules(withFeelings)).toEqual([]);
  });

  it("요구사항이 비어도 동작한다", () => {
    expect(rules(goodDraft, { requirements: "" })).toEqual([]);
  });
});
