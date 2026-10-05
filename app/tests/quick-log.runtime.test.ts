import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/index";
import { createQuickLogButton, createQuickLogEntry } from "../src/domains/planning";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const workerEnv = env as unknown as Env;

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await workerEnv.DB.prepare("DELETE FROM user_quick_logs").run();
  await workerEnv.DB.prepare("DELETE FROM user_quick_button_items").run();
  await workerEnv.DB.prepare("DELETE FROM user_quick_buttons").run();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quick log runtime", () => {
  it("records the save-time timestamp even when logged_at is provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T01:40:00.000Z"));

    const withClientTimestamp = await createQuickLogEntry(workerEnv, "quick-user-1", {
      id: "ql-save-moment",
      button_label: "💊 영양제",
      logged_at: "2020-01-01T00:00:00.000Z",
    });
    vi.setSystemTime(new Date("2026-07-25T01:41:00.000Z"));
    const withoutClientTimestamp = await createQuickLogEntry(workerEnv, "quick-user-1", {
      id: "ql-save-moment-2",
      button_label: "💊 영양제",
    });

    expect(withClientTimestamp.idempotent).toBe(false);
    expect(withClientTimestamp.log.logged_at).toBe("2026-07-25T01:40:00.000Z");
    expect(withoutClientTimestamp.idempotent).toBe(false);
    expect(withoutClientTimestamp.log.logged_at).toBe("2026-07-25T01:41:00.000Z");
  });

  it("treats duplicate log id from the same user as idempotent", async () => {
    const first = await createQuickLogEntry(workerEnv, "quick-user-2", {
      id: "ql-idempotent",
      button_label: "물",
      note: "first",
    });
    const second = await createQuickLogEntry(workerEnv, "quick-user-2", {
      id: "ql-idempotent",
      button_label: "물",
      note: "second",
    });

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.log.note).toBe("first");
  });

  it("blocks other users from reusing another user's log id", async () => {
    await createQuickLogEntry(workerEnv, "quick-user-3a", {
      id: "ql-owned",
      button_label: "스트레칭",
    });

    await expect(createQuickLogEntry(workerEnv, "quick-user-3b", {
      id: "ql-owned",
      button_label: "스트레칭",
    })).rejects.toMatchObject({
      status: 403,
      code: "quick_log_not_owned",
    });
  });

  it("does not allow creating a log with another user's button id", async () => {
    const created = await createQuickLogButton(workerEnv, "quick-user-4a", {
      label: "영양제",
      input_mode: "one_tap",
    });

    await expect(createQuickLogEntry(workerEnv, "quick-user-4b", {
      id: "ql-cross-user-button",
      button_id: created.button.id,
    })).rejects.toMatchObject({
      status: 404,
      code: "quick_log_button_not_found",
    });
  });
});
