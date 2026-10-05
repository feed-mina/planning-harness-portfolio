// Quick Log 리마인더 (#213 1차 MVP) 통합 테스트.
// 설정 API(get/upsert) -> ReminderService 메시지 생성 -> 스케줄러(processDueQuickLogReminders)가
// 정확한 시각에만, 하루 1회만, 교체 가능한 Sender로 발송하는지 검증한다.
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/index";
import {
  ReminderService,
  ConsoleSender,
  getQuickLogReminder,
  upsertQuickLogReminder,
  processDueQuickLogReminders,
  type ReminderSender,
  type ReminderUser,
} from "../src/domains/planning";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const workerEnv = env as unknown as Env;
const USER = "reminder-user";

class RecordingSender implements ReminderSender {
  calls: { user: ReminderUser; message: string }[] = [];
  async send(user: ReminderUser, message: string): Promise<void> {
    this.calls.push({ user, message });
  }
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await workerEnv.DB.prepare("DELETE FROM quick_log_reminders").run();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quick log reminder settings API", () => {
  it("설정 전에는 null, 저장 후에는 값을 그대로 돌려준다", async () => {
    const before = await getQuickLogReminder(workerEnv, USER);
    expect(before.reminder).toBeNull();

    const created = await upsertQuickLogReminder(workerEnv, USER, { time: "21:00", timezone: "Asia/Seoul" });
    expect(created.reminder).toMatchObject({ user_id: USER, enabled: true, time: "21:00", timezone: "Asia/Seoul" });

    const fetched = await getQuickLogReminder(workerEnv, USER);
    expect(fetched.reminder).toMatchObject({ time: "21:00", enabled: true });
  });

  it("같은 사용자가 다시 저장하면 갱신(upsert)되고 새 행이 생기지 않는다", async () => {
    await upsertQuickLogReminder(workerEnv, USER, { time: "21:00", timezone: "Asia/Seoul" });
    await upsertQuickLogReminder(workerEnv, USER, { time: "07:30", timezone: "Asia/Seoul", enabled: false });

    const count = await workerEnv.DB.prepare("SELECT COUNT(*) AS c FROM quick_log_reminders WHERE user_id=?")
      .bind(USER).first<{ c: number }>();
    expect(count?.c).toBe(1);

    const fetched = await getQuickLogReminder(workerEnv, USER);
    expect(fetched.reminder).toMatchObject({ time: "07:30", enabled: false });
  });

  it("잘못된 시간 형식은 거부한다", async () => {
    await expect(upsertQuickLogReminder(workerEnv, USER, { time: "25:99", timezone: "Asia/Seoul" }))
      .rejects.toMatchObject({ status: 400, code: "invalid_time" });
  });
});

describe("ReminderService / Sender", () => {
  it("createMessage는 고정 안내 문구를 반환한다", () => {
    expect(ReminderService.createMessage({ id: USER })).toBe(
      "안녕하세요. 오늘의 Quick Log를 남겨보세요. 오늘 하루는 어떠셨나요?",
    );
  });

  it("ConsoleSender는 console.log로 발송한다(카카오 미연동 상태의 기본 구현)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await new ConsoleSender().send({ id: USER }, "테스트 메시지");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain(USER);
    expect(spy.mock.calls[0][0]).toContain("테스트 메시지");
    spy.mockRestore();
  });
});

describe("processDueQuickLogReminders (scheduler)", () => {
  it("설정된 시각과 정확히 일치할 때만 발송하고, 다른 사용자의 시각은 건너뛴다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T09:30:00.000Z"));

    await upsertQuickLogReminder(workerEnv, "due-user", { time: "09:30", timezone: "UTC" });
    await upsertQuickLogReminder(workerEnv, "not-due-user", { time: "09:40", timezone: "UTC" });

    const sender = new RecordingSender();
    const result = await processDueQuickLogReminders(workerEnv, sender);

    expect(result.sent).toBe(1);
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0].user.id).toBe("due-user");
  });

  it("±5분 창 안(정확히 5분 차이)이면 발송하고, 창 밖(6분 차이)이면 건너뛴다 — 5분 주기 cron 대응", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T09:30:00.000Z"));

    await upsertQuickLogReminder(workerEnv, "edge-in-user", { time: "09:35", timezone: "UTC" }); // +5분, 경계 포함
    await upsertQuickLogReminder(workerEnv, "edge-out-user", { time: "09:24", timezone: "UTC" }); // -6분, 경계 밖

    const sender = new RecordingSender();
    const result = await processDueQuickLogReminders(workerEnv, sender);

    expect(result.sent).toBe(1);
    expect(sender.calls.map((c) => c.user.id)).toEqual(["edge-in-user"]);
  });

  it("자정 경계를 넘나드는 시각도 원형 거리로 올바르게 판정한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T00:01:00.000Z"));
    await upsertQuickLogReminder(workerEnv, "midnight-user", { time: "23:58", timezone: "UTC" }); // 자정 넘어 3분 차이

    const sender = new RecordingSender();
    const result = await processDueQuickLogReminders(workerEnv, sender);

    expect(result.sent).toBe(1);
    expect(sender.calls[0].user.id).toBe("midnight-user");
  });

  it("enabled=false인 리마인더는 발송하지 않는다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T09:30:00.000Z"));
    await upsertQuickLogReminder(workerEnv, "disabled-user", { time: "09:30", timezone: "UTC", enabled: false });

    const sender = new RecordingSender();
    const result = await processDueQuickLogReminders(workerEnv, sender);

    expect(result.sent).toBe(0);
  });

  it("같은 날 두 번 매칭돼도 하루 1회만 발송한다(중복 방지)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T09:30:00.000Z"));
    await upsertQuickLogReminder(workerEnv, "dedupe-user", { time: "09:30", timezone: "UTC" });

    const sender = new RecordingSender();
    const first = await processDueQuickLogReminders(workerEnv, sender);
    const second = await processDueQuickLogReminders(workerEnv, sender);

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(sender.calls).toHaveLength(1);
  });

  it("타임존이 다른 사용자도 각자의 로컬 시각 기준으로 매칭된다", async () => {
    vi.useFakeTimers();
    // 09:30 UTC == 18:30 Asia/Seoul (UTC+9)
    vi.setSystemTime(new Date("2026-07-25T09:30:00.000Z"));
    await upsertQuickLogReminder(workerEnv, "seoul-user", { time: "18:30", timezone: "Asia/Seoul" });

    const sender = new RecordingSender();
    const result = await processDueQuickLogReminders(workerEnv, sender);

    expect(result.sent).toBe(1);
    expect(sender.calls[0].user.id).toBe("seoul-user");
  });
});
