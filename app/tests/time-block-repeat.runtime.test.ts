// 시간 설정 반복 일정 규칙 통합 테스트.
// 그동안 클라이언트가 보낸 repeat_weekdays 를 서버가 버려서 반복 요일에 블록이 보이지 않았다.
// 실제 HTTP 라우트(worker.fetch)로 규칙 저장 → 요일 확장 → 삭제 범위를 검증한다.
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { signJWT } from "../src/core/auth";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const workerEnv = env as unknown as Env;
const executionContext = {} as ExecutionContext;
const JWT_SECRET = "time-block-repeat-test-secret";

// 2026-08-03 은 월요일이다. 아래 날짜는 모두 이 주(週)를 기준으로 고른다.
const MON = "2026-08-03";
const TUE = "2026-08-04";
const WED = "2026-08-05";
const NEXT_MON = "2026-08-10";
const BEFORE_START = "2026-07-27";

function testEnv(): Env {
  return { ...workerEnv, JWT_SECRET };
}

async function addUser(userId: string): Promise<void> {
  const ts = new Date().toISOString();
  await workerEnv.DB.prepare(
    "INSERT INTO users (id, github_login, github_id, created_at) VALUES (?1, ?2, NULL, ?3)",
  ).bind(userId, userId, ts).run();
}

async function sidCookie(userId: string): Promise<string> {
  const jwt = await signJWT({ sub: userId, login: userId }, JWT_SECRET);
  return `sid=${jwt}`;
}

async function createBlock(cookie: string, body: Record<string, unknown>) {
  const res = await worker.fetch(new Request("https://example.test/api/time-blocks", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  }), testEnv(), executionContext);
  return { status: res.status, json: await res.json() as any };
}

async function listBlocks(cookie: string, date: string) {
  const res = await worker.fetch(new Request(`https://example.test/api/time-blocks?date=${date}`, {
    headers: { cookie },
  }), testEnv(), executionContext);
  return { status: res.status, json: await res.json() as any };
}

async function listBlockRange(cookie: string, from: string, to: string) {
  const res = await worker.fetch(new Request(
    `https://example.test/api/time-blocks?from=${from}&to=${to}`,
    { headers: { cookie } },
  ), testEnv(), executionContext);
  return { status: res.status, json: await res.json() as any };
}

async function deleteBlock(cookie: string, id: string, date?: string) {
  const query = date ? `?date=${date}` : "";
  const res = await worker.fetch(new Request(`https://example.test/api/time-blocks/${id}${query}`, {
    method: "DELETE",
    headers: { cookie },
  }), testEnv(), executionContext);
  return { status: res.status, json: await res.json() as any };
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await workerEnv.DB.prepare("DELETE FROM user_time_block_rule_skips").run();
  await workerEnv.DB.prepare("DELETE FROM user_time_block_rules").run();
  await workerEnv.DB.prepare("DELETE FROM user_time_blocks").run();
  await workerEnv.DB.prepare("DELETE FROM users").run();
});

describe("time block calendar range", () => {
  it("expands rules and returns authoritative server time", async () => {
    await addUser("range-user");
    const cookie = await sidCookie("range-user");
    await createBlock(cookie, {
      date: MON,
      start_time: "09:00",
      end_time: "10:00",
      kind: "focus",
      repeat_weekdays: [1, 3],
    });
    await createBlock(cookie, {
      date: TUE,
      start_time: "13:00",
      end_time: "14:00",
      kind: "meeting",
    });

    const result = await listBlockRange(cookie, MON, NEXT_MON);
    expect(result.status).toBe(200);
    expect(result.json.days).toHaveLength(8);
    expect(result.json.days.find((day: any) => day.date === MON).blocks).toHaveLength(1);
    expect(result.json.days.find((day: any) => day.date === TUE).blocks[0].kind).toBe("meeting");
    expect(result.json.days.find((day: any) => day.date === WED).blocks[0].source).toBe("rule");
    expect(result.json.days.find((day: any) => day.date === NEXT_MON).blocks[0].source).toBe("rule");
    expect(Number.isNaN(Date.parse(result.json.server_now))).toBe(false);
    expect(result.json.timezone).toBe("Asia/Seoul");
  });

  it("rejects ranges longer than 42 days", async () => {
    await addUser("range-limit");
    const cookie = await sidCookie("range-limit");
    const result = await listBlockRange(cookie, "2026-08-01", "2026-09-12");
    expect(result.status).toBe(400);
    expect(result.json.code).toBe("date_range_too_large");
  });
});

describe("반복 일정 규칙", () => {
  it("repeat_weekdays 를 보내면 규칙으로 저장되고 해당 요일에 블록이 보인다", async () => {
    await addUser("u1");
    const cookie = await sidCookie("u1");

    const created = await createBlock(cookie, {
      date: MON,
      start_time: "09:00",
      end_time: "10:00",
      kind: "focus",
      note: "주간 집중",
      repeat_weekdays: [1, 3],
    });
    expect(created.status).toBe(200);
    expect(created.json.rule).toBeTruthy();
    expect(created.json.rule.weekdays).toEqual([1, 3]);
    expect(created.json.block).toBeUndefined();

    // 규칙 행은 하나만 생기고, 하루짜리 블록은 만들지 않는다.
    const ruleCount = await workerEnv.DB.prepare("SELECT COUNT(*) AS n FROM user_time_block_rules").first<{ n: number }>();
    const blockCount = await workerEnv.DB.prepare("SELECT COUNT(*) AS n FROM user_time_blocks").first<{ n: number }>();
    expect(ruleCount?.n).toBe(1);
    expect(blockCount?.n).toBe(0);

    const monday = await listBlocks(cookie, MON);
    expect(monday.json.blocks).toHaveLength(1);
    expect(monday.json.blocks[0].source).toBe("rule");
    expect(monday.json.blocks[0].start_time).toBe("09:00");
    expect(monday.json.blocks[0].repeat_weekdays).toEqual([1, 3]);
    expect(monday.json.blocks[0].id.startsWith("rule-")).toBe(true);

    const wednesday = await listBlocks(cookie, WED);
    expect(wednesday.json.blocks).toHaveLength(1);

    const nextMonday = await listBlocks(cookie, NEXT_MON);
    expect(nextMonday.json.blocks).toHaveLength(1);

    // 규칙에 없는 요일과 시작일 이전에는 나오지 않는다.
    expect((await listBlocks(cookie, TUE)).json.blocks).toHaveLength(0);
    expect((await listBlocks(cookie, BEFORE_START)).json.blocks).toHaveLength(0);
  });

  it("repeat_weekdays 가 없으면 기존처럼 하루짜리 블록만 만든다", async () => {
    await addUser("u2");
    const cookie = await sidCookie("u2");

    const created = await createBlock(cookie, { date: MON, start_time: "13:00", end_time: "14:00" });
    expect(created.json.block).toBeTruthy();
    expect(created.json.rule).toBeUndefined();

    const monday = await listBlocks(cookie, MON);
    expect(monday.json.blocks).toHaveLength(1);
    expect(monday.json.blocks[0].source).toBe("block");
    expect((await listBlocks(cookie, NEXT_MON)).json.blocks).toHaveLength(0);
  });

  it("repeat_ends_on 이후에는 반복이 멈춘다", async () => {
    await addUser("u3");
    const cookie = await sidCookie("u3");

    await createBlock(cookie, {
      date: MON,
      start_time: "09:00",
      end_time: "10:00",
      repeat_weekdays: [1],
      repeat_ends_on: MON,
    });

    expect((await listBlocks(cookie, MON)).json.blocks).toHaveLength(1);
    expect((await listBlocks(cookie, NEXT_MON)).json.blocks).toHaveLength(0);
  });

  it("date 를 붙여 삭제하면 그 날짜만 반복에서 빠진다", async () => {
    await addUser("u4");
    const cookie = await sidCookie("u4");

    await createBlock(cookie, { date: MON, start_time: "09:00", end_time: "10:00", repeat_weekdays: [1] });
    const blockId = (await listBlocks(cookie, MON)).json.blocks[0].id;

    const removed = await deleteBlock(cookie, blockId, MON);
    expect(removed.json).toMatchObject({ ok: true, scope: "occurrence", date: MON });

    expect((await listBlocks(cookie, MON)).json.blocks).toHaveLength(0);
    expect((await listBlocks(cookie, NEXT_MON)).json.blocks).toHaveLength(1);
  });

  it("date 없이 삭제하면 규칙 전체가 사라진다", async () => {
    await addUser("u5");
    const cookie = await sidCookie("u5");

    await createBlock(cookie, { date: MON, start_time: "09:00", end_time: "10:00", repeat_weekdays: [1] });
    const blockId = (await listBlocks(cookie, MON)).json.blocks[0].id;

    const removed = await deleteBlock(cookie, blockId);
    expect(removed.json).toMatchObject({ ok: true, scope: "rule" });

    expect((await listBlocks(cookie, MON)).json.blocks).toHaveLength(0);
    expect((await listBlocks(cookie, NEXT_MON)).json.blocks).toHaveLength(0);
    const ruleCount = await workerEnv.DB.prepare("SELECT COUNT(*) AS n FROM user_time_block_rules").first<{ n: number }>();
    expect(ruleCount?.n).toBe(0);
  });

  it("다른 사용자의 반복 규칙은 보이지도 지워지지도 않는다", async () => {
    await addUser("owner");
    await addUser("other");
    const ownerCookie = await sidCookie("owner");
    const otherCookie = await sidCookie("other");

    await createBlock(ownerCookie, { date: MON, start_time: "09:00", end_time: "10:00", repeat_weekdays: [1] });
    const blockId = (await listBlocks(ownerCookie, MON)).json.blocks[0].id;

    expect((await listBlocks(otherCookie, MON)).json.blocks).toHaveLength(0);

    const removed = await deleteBlock(otherCookie, blockId);
    expect(removed.json.ok).toBe(false);
    expect((await listBlocks(ownerCookie, MON)).json.blocks).toHaveLength(1);
  });

  it("로그인하지 않으면 반복 규칙 목록을 볼 수 없다", async () => {
    const res = await worker.fetch(
      new Request("https://example.test/api/time-block-rules"),
      testEnv(),
      executionContext,
    );
    expect(res.status).toBe(401);
  });
});
