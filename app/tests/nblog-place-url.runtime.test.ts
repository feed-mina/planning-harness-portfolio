import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handleNBlogApi, isPlaceholderPlaceUrl, nblogErrorResponse, type NBlogActor, type NBlogEnv } from "../src/domains/nblog";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      R2: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const actor: NBlogActor = { userId: "place-user", label: "QA", viaToken: false };
const workerEnv = env as unknown as NBlogEnv;

describe("플레이스 링크 자리표시자 판별 (#190)", () => {
  it("지도·플레이스 홈 주소는 자리표시자로 본다", () => {
    for (const url of [
      "https://map.naver.com/",
      "https://map.naver.com",
      "https://www.map.naver.com/",
      "https://m.map.naver.com/",
      "https://place.naver.com/",
      "https://naver.me/",
      "https://naver.com/",
    ]) {
      expect(isPlaceholderPlaceUrl(url), url).toBe(true);
    }
  });

  it("특정 장소를 가리키면 통과시킨다", () => {
    for (const url of [
      "https://naver.me/FDjil0KT",
      "https://map.naver.com/p/entry/place/1234567",
      "https://m.place.naver.com/restaurant/1234567/home",
      "https://map.naver.com/?query=미생맥주",
    ]) {
      expect(isPlaceholderPlaceUrl(url), url).toBe(false);
    }
  });

  it("URL 이 아니면 자리표시자로 본다", () => {
    expect(isPlaceholderPlaceUrl("")).toBe(true);
    expect(isPlaceholderPlaceUrl("미생맥주")).toBe(true);
  });
});

describe("캠페인 생성이 자리표시자 링크를 거부한다 (#190)", () => {
  beforeEach(async () => {
    await applyD1Migrations(workerEnv.DB, env.TEST_MIGRATIONS);
    await workerEnv.DB.prepare("DELETE FROM nblog_campaigns WHERE user_id=?1").bind(actor.userId).run();
  }, 30_000);

  async function create(placeUrl: string): Promise<{ status: number; code: string | null }> {
    const request = new Request("https://example.com/api/nblog/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body: JSON.stringify({
        campaign_id: "NB-PLACE", campaign_name: "링크 검증", campaign_url: "https://example.com/c",
        place_url: placeUrl, visit_date: "2026-07-12", user_tags: ["x"],
      }),
    });
    let response: Response;
    try {
      response = (await handleNBlogApi(request, workerEnv, actor))!;
    } catch (error) {
      response = nblogErrorResponse(error, request);
    }
    const payload = await response.json() as { error?: { code?: string } };
    return { status: response.status, code: payload?.error?.code ?? null };
  }

  it("지도 홈 주소로는 캠페인을 만들 수 없다", async () => {
    const result = await create("https://map.naver.com/");

    expect(result.status).toBe(400);
    expect(result.code).toBe("invalid_place_url");
  });

  it("실제 플레이스 링크는 통과한다", async () => {
    const result = await create("https://naver.me/FDjil0KT");

    expect(result.status).toBe(201);
    expect(result.code).toBeNull();
  });
});
