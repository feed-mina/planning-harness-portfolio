import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handleNBlogApi, nblogErrorResponse, type NBlogActor, type NBlogEnv } from "../src/domains/nblog";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      R2: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

/**
 * #183 — 발행 화면을 별도 화면으로 분리(#182)하면서 승인 게이트가 풀리지 않는지
 * 검증한다. UI 만 잠그면 API 직접 호출로 우회되므로 **서버측**을 확인한다.
 */
const actor: NBlogActor = { userId: "gate-user", label: "QA", viaToken: false };
const workerEnv = env as unknown as NBlogEnv;
const CAMPAIGN = "NB-GATE";
const now = "2026-07-21T00:00:00.000Z";

function post(path: string, body: unknown): Request {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com" },
    body: JSON.stringify(body),
  });
}

/** handleNBlogApi 는 게이트 위반 시 NBlogError 를 던진다. 워커 진입점처럼 응답으로 바꾼다. */
async function dispatch(request: Request, requestActor: NBlogActor = actor): Promise<Response> {
  try {
    const response = await handleNBlogApi(request, workerEnv, requestActor);
    if (!response) throw new Error(`no route for ${request.url}`);
    return response;
  } catch (error) {
    return nblogErrorResponse(error, request);
  }
}

async function call(path: string, body: unknown): Promise<{ status: number; code: string | null }> {
  const response = await dispatch(post(path, body));
  const payload = await response.json() as { error?: { code?: string } };
  return { status: response.status, code: payload?.error?.code ?? null };
}

async function seedCampaign(overrides: Record<string, string | number | null> = {}): Promise<void> {
  await workerEnv.DB.prepare("DELETE FROM nblog_campaigns WHERE user_id=?1").bind(actor.userId).run();
  await workerEnv.DB.prepare(
    `INSERT INTO nblog_campaigns
      (user_id,campaign_id,campaign_name,campaign_url,place_url,visit_date,visit_notes,requirements,
       tone_profile,user_tags_json,source_folder,status,contract_version,operation_status,
       validation_passed,approved_at,created_at,updated_at,version)
     VALUES (?1,?2,'게이트 검증','https://example.com/c','https://naver.me/x','2026-07-12','','',
       '','[]','source/x',?3,'1.1',?4,?5,?6,?7,?7,1)`
  ).bind(
    actor.userId, CAMPAIGN,
    String(overrides.status ?? "scheduled"),
    String(overrides.operation_status ?? "approved_for_handoff"),
    Number(overrides.validation_passed ?? 1),
    overrides.approved_at === null ? null : String(overrides.approved_at ?? now),
    now,
  ).run();
}

const publishBody = {
  expected_updated_at: now,
  expected_version: 1,
  published_url: "https://blog.naver.com/myelin24/223999000111",
  published_at: "2026-07-21T01:00:00.000Z",
  checklist: { title: true, sponsor_disclosure: true, map: true, media: true, tags: true },
};
const handoffBody = { expected_updated_at: now, expected_version: 1 };

describe("발행 게이트는 서버에서 강제된다 (#183)", () => {
  beforeEach(async () => {
    await applyD1Migrations(workerEnv.DB, env.TEST_MIGRATIONS);
  }, 30_000);

  it("검증 미통과 캠페인은 인계 세션을 만들 수 없다", async () => {
    await seedCampaign({ validation_passed: 0 });

    const result = await call(`/api/nblog/campaigns/${CAMPAIGN}/handoff-sessions`, handoffBody);

    expect(result.status).toBe(409);
    expect(result.code).toBe("handoff_gate_blocked");
  });

  it("승인 전 캠페인은 인계 세션을 만들 수 없다", async () => {
    await seedCampaign({ approved_at: null });

    const result = await call(`/api/nblog/campaigns/${CAMPAIGN}/handoff-sessions`, handoffBody);

    expect(result.status).toBe(409);
    expect(result.code).toBe("handoff_gate_blocked");
  });

  it("검증 미통과 캠페인은 발행 결과를 기록할 수 없다", async () => {
    await seedCampaign({ validation_passed: 0 });

    const result = await call(`/api/nblog/campaigns/${CAMPAIGN}/publish-result`, publishBody);

    expect(result.status).toBe(409);
    expect(result.code).toBe("publication_gate_blocked");
  });

  it("승인 전 캠페인은 발행 결과를 기록할 수 없다", async () => {
    await seedCampaign({ approved_at: null });

    const result = await call(`/api/nblog/campaigns/${CAMPAIGN}/publish-result`, publishBody);

    expect(result.status).toBe(409);
    expect(result.code).toBe("publication_gate_blocked");
  });

  it("CLI 동기화 토큰으로는 인계 세션을 만들 수 없다", async () => {
    await seedCampaign();
    const tokenActor: NBlogActor = { ...actor, viaToken: true };

    const response = await dispatch(
      post(`/api/nblog/campaigns/${CAMPAIGN}/handoff-sessions`, handoffBody), tokenActor,
    );
    const payload = await response.json() as { error?: { code?: string } };

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("sync_token_scope_forbidden");
  });

  it("게이트를 통과한 캠페인은 발행 결과 기록이 막히지 않는다", async () => {
    await seedCampaign();

    const result = await call(`/api/nblog/campaigns/${CAMPAIGN}/publish-result`, publishBody);

    // 게이트 통과가 확인 대상이다. 다른 이유(중복 URL 등)로 막히면 안 된다.
    expect(result.code).not.toBe("publication_gate_blocked");
  });
});
