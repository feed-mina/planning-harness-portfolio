import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handleNBlogApi, type NBlogActor, type NBlogEnv } from "../src/domains/nblog";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      R2: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const actor: NBlogActor = { userId: "req-user", label: "QA", viaToken: false };
const workerEnv = env as unknown as NBlogEnv;
const CAMPAIGN = "NB-REQ";

const GUIDELINE = "필수 키워드: 인계동술집 3회, 미생맥주 3회 / 영업시간 17:00~20:00 / 권선동 1016-15";

async function createCampaign(extra: Record<string, unknown> = {}): Promise<Response> {
  const request = new Request("https://example.com/api/nblog/campaigns", {
    method: "POST",
    // 쓰기 요청은 same-origin 만 허용된다(CSRF 가드).
    headers: { "content-type": "application/json", origin: "https://example.com" },
    body: JSON.stringify({
      campaign_id: CAMPAIGN, campaign_name: "요구사항 검증", campaign_url: "https://example.com/c",
      place_url: "https://naver.me/abc", visit_date: "2026-07-12", user_tags: ["미생맥주"], ...extra,
    }),
  });
  const response = await handleNBlogApi(request, workerEnv, actor);
  if (!response) throw new Error("no route");
  return response;
}

async function storedRequirements(): Promise<string | null> {
  const row = await workerEnv.DB
    .prepare("SELECT requirements FROM nblog_campaigns WHERE user_id=?1 AND campaign_id=?2")
    .bind(actor.userId, CAMPAIGN)
    .first<{ requirements: string }>();
  return row?.requirements ?? null;
}

describe("체험단 요구사항을 캠페인에 저장한다", () => {
  beforeEach(async () => {
    await applyD1Migrations(workerEnv.DB, env.TEST_MIGRATIONS);
    await workerEnv.DB.prepare("DELETE FROM nblog_campaigns WHERE user_id=?1").bind(actor.userId).run();
  }, 30_000);

  it("가이드라인 원문을 그대로 보관한다", async () => {
    const response = await createCampaign({ requirements: GUIDELINE });

    expect(response.status).toBe(201);
    expect(await storedRequirements()).toBe(GUIDELINE);
  });

  it("요구사항 없이도 캠페인을 만들 수 있다", async () => {
    const response = await createCampaign();

    expect(response.status).toBe(201);
    expect(await storedRequirements()).toBe("");
  });

  it("다시 저장하면 요구사항이 갱신된다", async () => {
    await createCampaign({ requirements: GUIDELINE });
    await createCampaign({ requirements: "변경된 가이드라인" });

    expect(await storedRequirements()).toBe("변경된 가이드라인");
  });

  it("캠페인 조회 응답에 요구사항이 포함된다", async () => {
    await createCampaign({ requirements: GUIDELINE });

    const listResponse = await handleNBlogApi(
      new Request("https://example.com/api/nblog/campaigns"), workerEnv, actor,
    );
    const body = await listResponse!.json() as { campaigns: Array<{ campaign_id: string; requirements: string }> };
    const found = body.campaigns.find((item) => item.campaign_id === CAMPAIGN);

    expect(found?.requirements).toBe(GUIDELINE);
  });
});
