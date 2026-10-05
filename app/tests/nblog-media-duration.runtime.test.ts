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

const actor: NBlogActor = { userId: "duration-user", label: "QA CLI", viaToken: true };
const workerEnv = env as unknown as NBlogEnv;
const CAMPAIGN = "NB-DURATION";

function request(path: string, body: unknown): Request {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function call(path: string, body: unknown): Promise<Response> {
  const response = await handleNBlogApi(request(path, body), workerEnv, actor);
  if (!response) throw new Error(`no route for ${path}`);
  return response;
}

async function initUpload(files: unknown[]): Promise<Response> {
  return await call(`/api/nblog/campaigns/${CAMPAIGN}/media/upload-init`, { files });
}

async function storedDuration(mediaId: string): Promise<number | null> {
  const row = await workerEnv.DB
    .prepare("SELECT duration FROM nblog_media_assets WHERE user_id=?1 AND campaign_id=?2 AND media_id=?3")
    .bind(actor.userId, CAMPAIGN, mediaId)
    .first<{ duration: number | null }>();
  return row?.duration ?? null;
}

const checksum = `sha256:${"a".repeat(64)}`;

describe("upload-init 이 영상 길이를 저장한다 (#171)", () => {
  beforeEach(async () => {
    await applyD1Migrations(workerEnv.DB, env.TEST_MIGRATIONS);
    await call("/api/nblog/campaigns", {
      campaign_id: CAMPAIGN, campaign_name: "duration 검증", campaign_url: "https://example.com/c",
      place_url: "https://naver.me/abc", visit_date: "2026-07-12", user_tags: ["검증"],
    });
  }, 30_000);

  it("클라이언트가 보낸 영상 길이를 그대로 저장한다", async () => {
    const response = await initUpload([
      { media_id: "v1", original_name: "clip.mp4", content_type: "video/mp4", size: 1_000, checksum, duration: 3.944, order: 1 },
    ]);

    expect(response.status).toBe(201);
    expect(await storedDuration("v1")).toBeCloseTo(3.944, 3);
  });

  it("길이를 안 보내면 null 로 두고 업로드는 계속된다", async () => {
    const response = await initUpload([
      { media_id: "v2", original_name: "clip.mp4", content_type: "video/mp4", size: 1_000, checksum, order: 1 },
    ]);

    expect(response.status).toBe(201);
    expect(await storedDuration("v2")).toBeNull();
  });

  it("음수·0·비정상 값은 저장하지 않는다", async () => {
    for (const [index, duration] of [0, -5, Number.NaN, "abc", 90_000].entries()) {
      const mediaId = `bad-${index}`;
      const response = await initUpload([
        { media_id: mediaId, original_name: "clip.mp4", content_type: "video/mp4", size: 1_000, checksum, duration, order: 1 },
      ]);
      expect(response.status).toBe(201);
      expect(await storedDuration(mediaId)).toBeNull();
    }
  });

  it("사진에는 길이를 붙이지 않는다", async () => {
    const response = await initUpload([
      { media_id: "p1", original_name: "photo.jpg", content_type: "image/jpeg", size: 1_000, checksum, duration: 12.5, order: 1 },
    ]);

    expect(response.status).toBe(201);
    expect(await storedDuration("p1")).toBeNull();
  });

  it("같은 media_id 로 다시 올리면 길이가 갱신된다", async () => {
    await initUpload([{ media_id: "v3", original_name: "a.mp4", content_type: "video/mp4", size: 1_000, checksum, duration: 3.9, order: 1 }]);
    await initUpload([{ media_id: "v3", original_name: "b.mp4", content_type: "video/mp4", size: 2_000, checksum, duration: 12.1, order: 1 }]);

    expect(await storedDuration("v3")).toBeCloseTo(12.1, 3);
  });
});
