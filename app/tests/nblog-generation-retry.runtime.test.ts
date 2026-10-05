import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { startNBlogGeneration } from "../src/domains/nblog";
import type { NBlogActor, NBlogEnv } from "../src/domains/nblog";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      R2: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const actor: NBlogActor = { userId: "retry-user", label: "QA", viaToken: false };
const workerEnv = env as unknown as NBlogEnv;
const CAMPAIGN = "NB-RETRY";
const now = "2026-07-21T00:00:00.000Z";

function envWith(created: string[]): NBlogEnv {
  return {
    ...workerEnv,
    NBLOG_WORKFLOW: {
      create: async ({ id }: { id: string }) => { created.push(id); return {} as never; },
    },
  } as unknown as NBlogEnv;
}

async function seedCampaign(): Promise<void> {
  // applyD1Migrations 는 마이그레이션만 적용하고 데이터를 비우지 않는다.
  for (const table of ["nblog_generation_runs", "nblog_media_assets", "nblog_campaigns"]) {
    await workerEnv.DB.prepare(`DELETE FROM ${table} WHERE user_id=?1`).bind(actor.userId).run();
  }
  await workerEnv.DB.prepare(
    `INSERT INTO nblog_campaigns
      (user_id,campaign_id,campaign_name,campaign_url,place_url,visit_date,visit_notes,
       tone_profile,user_tags_json,source_folder,status,contract_version,operation_status,created_at,updated_at)
     VALUES (?1,?2,'재시도 검증','https://example.com/c','https://naver.me/x','2026-07-12','',
       '','[]','source/x','queued','1.1','local_ready',?3,?3)`
  ).bind(actor.userId, CAMPAIGN, now).run();

  await workerEnv.DB.prepare(
    `INSERT INTO nblog_media_assets
      (user_id,campaign_id,media_id,type,original_name,object_key,content_type,size,checksum,
       sort_order,included,is_cover,status,updated_at)
     VALUES (?1,?2,'v1','video','a.mp4','k/a.mp4','video/mp4',1000,?3,1,1,0,'ready',?4)`
  ).bind(actor.userId, CAMPAIGN, `sha256:${"a".repeat(64)}`, now).run();
}

async function runRow(): Promise<{ id: string; status: string; error_message: string | null } | null> {
  return await workerEnv.DB
    .prepare("SELECT id,status,error_message FROM nblog_generation_runs WHERE user_id=?1 AND campaign_id=?2")
    .bind(actor.userId, CAMPAIGN)
    .first<{ id: string; status: string; error_message: string | null }>();
}

describe("실패한 글 생성을 다시 시작할 수 있다 (#171)", () => {
  beforeEach(async () => {
    await applyD1Migrations(workerEnv.DB, env.TEST_MIGRATIONS);
    await seedCampaign();
  }, 30_000);

  it("첫 생성은 새 실행을 만든다", async () => {
    const created: string[] = [];
    const result = await startNBlogGeneration(envWith(created), actor, CAMPAIGN);

    expect(result.reused).toBe(false);
    expect(result.status).toBe("generating");
    expect(created).toHaveLength(1);
  });

  it("진행 중인 실행은 재사용한다 (중복 생성 방지)", async () => {
    const created: string[] = [];
    const first = await startNBlogGeneration(envWith(created), actor, CAMPAIGN);
    const second = await startNBlogGeneration(envWith(created), actor, CAMPAIGN);

    expect(second.reused).toBe(true);
    expect(second.run_id).toBe(first.run_id);
    expect(created).toHaveLength(1);
  });

  it("이미 성공한 실행도 사진이 같으면 다시 시작할 수 있다", async () => {
    // staging 회귀: 생성 로직을 고친 뒤 '다시 만들기'를 눌러도 completed 실행이 재사용되어
    // 워크플로가 아예 시작되지 않았다.
    const created: string[] = [];
    const first = await startNBlogGeneration(envWith(created), actor, CAMPAIGN);
    await workerEnv.DB.prepare(
      "UPDATE nblog_generation_runs SET status='completed',completed_at=?2 WHERE id=?1"
    ).bind(first.run_id, now).run();

    const again = await startNBlogGeneration(envWith(created), actor, CAMPAIGN);

    expect(again.reused).toBe(false);
    expect(again.status).toBe("generating");
    expect(created).toHaveLength(2);
    expect(created[1]).not.toBe(created[0]);
  });

  it("실패한 실행은 재사용하지 않고 다시 시작한다", async () => {
    const created: string[] = [];
    const first = await startNBlogGeneration(envWith(created), actor, CAMPAIGN);

    await workerEnv.DB.prepare(
      "UPDATE nblog_generation_runs SET status='failed',error_code='generation_failed',error_message='OpenAI 401' WHERE id=?1"
    ).bind(first.run_id).run();
    await workerEnv.DB.prepare(
      "UPDATE nblog_campaigns SET status='failed',generation_status='generation_failed',operation_status='failed',failure_reason='OpenAI 401' WHERE user_id=?1 AND campaign_id=?2"
    ).bind(actor.userId, CAMPAIGN).run();

    const retried = await startNBlogGeneration(envWith(created), actor, CAMPAIGN);

    expect(retried.reused).toBe(false);
    expect(retried.status).toBe("generating");
    expect(created).toHaveLength(2);
    // 워크플로 인스턴스 id 는 종료된 것을 재사용할 수 없어 달라야 한다
    expect(created[1]).not.toBe(created[0]);
  });

  it("재시작하면 실행 기록의 실패 흔적이 지워진다", async () => {
    const created: string[] = [];
    const first = await startNBlogGeneration(envWith(created), actor, CAMPAIGN);
    await workerEnv.DB.prepare(
      "UPDATE nblog_generation_runs SET status='failed',error_code='generation_failed',error_message='OpenAI 401' WHERE id=?1"
    ).bind(first.run_id).run();

    await startNBlogGeneration(envWith(created), actor, CAMPAIGN);

    const row = await runRow();
    expect(row?.status).toBe("generating");
    expect(row?.error_message).toBeNull();
    // UNIQUE(user_id,campaign_id,input_hash) 때문에 행은 하나로 유지된다
    expect(row?.id).toBe(first.run_id);
  });

  it("재시작하면 캠페인의 실패 표시도 해제된다", async () => {
    const created: string[] = [];
    const first = await startNBlogGeneration(envWith(created), actor, CAMPAIGN);
    await workerEnv.DB.prepare("UPDATE nblog_generation_runs SET status='failed' WHERE id=?1").bind(first.run_id).run();
    await workerEnv.DB.prepare(
      "UPDATE nblog_campaigns SET status='failed',generation_status='generation_failed',failure_reason='OpenAI 401' WHERE user_id=?1 AND campaign_id=?2"
    ).bind(actor.userId, CAMPAIGN).run();

    await startNBlogGeneration(envWith(created), actor, CAMPAIGN);

    const campaign = await workerEnv.DB
      .prepare("SELECT status,generation_status,failure_reason FROM nblog_campaigns WHERE user_id=?1 AND campaign_id=?2")
      .bind(actor.userId, CAMPAIGN)
      .first<{ status: string; generation_status: string; failure_reason: string | null }>();

    expect(campaign?.generation_status).toBe("generating");
    expect(campaign?.failure_reason).toBeNull();
  });
});
