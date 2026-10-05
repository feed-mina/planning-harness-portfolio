import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { renderPromptTemplate, resolvePromptTemplate, validatePromptTemplate, type NBlogEnv } from "../src/domains/nblog";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      R2: R2Bucket;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const workerEnv = env as unknown as NBlogEnv;
const USER = "prompt-user";
const now = "2026-07-21T00:00:00.000Z";

/**
 * #188 — 프롬프트 편집 UI 와 실제 생성이 서로 다른 문자열을 쓰고 있었다. 사용자가
 * '글 작성 규칙'을 고쳐도 결과가 그대로였다.
 */
describe("프롬프트 템플릿 채우기", () => {
  it("자리표시자를 값으로 바꾼다", () => {
    const out = renderPromptTemplate("캠페인: {{campaign_name}} / 문체: {{tone_profile}}", {
      campaign_name: "미생맥주", tone_profile: "편안한 구어체",
    });

    expect(out).toBe("캠페인: 미생맥주 / 문체: 편안한 구어체");
  });

  it("값이 없는 자리표시자는 빈 문자열로 둔다", () => {
    expect(renderPromptTemplate("메모: {{visit_notes}}!", {})).toBe("메모: !");
  });

  it("공백이 들어간 자리표시자도 처리한다", () => {
    expect(renderPromptTemplate("{{ campaign_name }}", { campaign_name: "미생맥주" })).toBe("미생맥주");
  });
});

describe("생성이 쓸 템플릿 고르기 (#188)", () => {
  beforeEach(async () => {
    await applyD1Migrations(workerEnv.DB, env.TEST_MIGRATIONS);
    for (const table of ["nblog_prompt_profile_versions", "nblog_prompt_profiles"]) {
      await workerEnv.DB.prepare(`DELETE FROM ${table} WHERE user_id=?1`).bind(USER).run();
    }
  }, 30_000);

  async function seedProfile(id: string, template: string): Promise<void> {
    await workerEnv.DB.prepare(
      `INSERT INTO nblog_prompt_profiles (user_id,prompt_profile_id,name,current_version,scope,is_active,created_by,created_at,updated_at)
       VALUES (?1,?2,'테스트 규칙',1,'account',1,'qa',?3,?3)`
    ).bind(USER, id, now).run();
    await workerEnv.DB.prepare(
      `INSERT INTO nblog_prompt_profile_versions (user_id,prompt_profile_id,version,template,allowed_placeholders,change_reason,created_by,created_at)
       VALUES (?1,?2,1,?3,'[]','최초',?4,?5)`
    ).bind(USER, id, template, "qa", now).run();
  }

  it("아무것도 지정하지 않으면 기본 템플릿을 쓴다", async () => {
    const result = await resolvePromptTemplate(workerEnv, USER, {});

    expect(result.source).toBe("system-default");
    expect(result.template).toContain("{{campaign_name}}");
  });

  it("캠페인 프로필을 지정하면 그 템플릿을 쓴다", async () => {
    await seedProfile("profile-a", "내가 만든 규칙 {{campaign_name}}");

    const result = await resolvePromptTemplate(workerEnv, USER, { prompt_profile_id: "profile-a" });

    expect(result.source).toBe("profile:profile-a");
    expect(result.template).toBe("내가 만든 규칙 {{campaign_name}}");
  });

  it("캠페인별 override 가 프로필보다 우선한다", async () => {
    await seedProfile("profile-a", "프로필 템플릿");

    const result = await resolvePromptTemplate(workerEnv, USER, {
      prompt_profile_id: "profile-a", prompt_override: "이 캠페인만 다른 규칙",
    });

    expect(result.source).toBe("campaign-override");
    expect(result.template).toBe("이 캠페인만 다른 규칙");
  });

  it("없는 프로필을 가리키면 기본 템플릿으로 떨어진다", async () => {
    const result = await resolvePromptTemplate(workerEnv, USER, { prompt_profile_id: "없는-프로필" });

    expect(result.source).toBe("system-default");
  });

  it("비활성 프로필은 쓰지 않는다", async () => {
    await seedProfile("profile-b", "비활성 템플릿");
    await workerEnv.DB.prepare("UPDATE nblog_prompt_profiles SET is_active=0 WHERE user_id=?1 AND prompt_profile_id=?2")
      .bind(USER, "profile-b").run();

    const result = await resolvePromptTemplate(workerEnv, USER, { prompt_profile_id: "profile-b" });

    expect(result.source).toBe("system-default");
  });
});

describe("기본 템플릿은 편집 UI 의 검증을 통과한다", () => {
  it("필수 자리표시자를 모두 갖는다", async () => {
    const { template } = await resolvePromptTemplate(workerEnv, USER, {});

    const result = validatePromptTemplate(template);

    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
