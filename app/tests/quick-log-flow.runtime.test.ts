// Quick Log 실사용자 흐름 통합 테스트 (#207 P1~P4).
// 프론트(quick-log.js)가 실제로 호출하는 순서 그대로: 버튼 생성 → 기록(원탭/항목선택/자유입력)
// → overview(오늘 진행도·스트릭·주간 뷰) → 이력 조회 → 버튼 수정/삭제까지 한 흐름으로 검증한다.
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/index";
import {
  createQuickLogButton,
  updateQuickLogButton,
  deleteQuickLogButton,
  createQuickLogEntry,
  deleteQuickLogEntry,
  restoreQuickLogEntry,
  getQuickLogOverview,
  getQuickLogHistory,
  getQuickLogPhoto,
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
const USER = "quick-flow-user";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await workerEnv.DB.prepare("DELETE FROM user_quick_logs").run();
  await workerEnv.DB.prepare("DELETE FROM user_quick_button_items").run();
  await workerEnv.DB.prepare("DELETE FROM user_quick_buttons").run();
});

describe("quick log end-to-end user flow (P1~P4)", () => {
  it("원탭 버튼: 헤더 클릭 → 즉시 기록 → 오늘 진행도·주간 스트릭 반영", async () => {
    const created = await createQuickLogButton(workerEnv, USER, {
      label: "물 마시기", emoji: "💧", input_mode: "one_tap", goal_count: 2,
    });
    expect(created.button.input_mode).toBe("one_tap");

    await createQuickLogEntry(workerEnv, USER, { id: "flow-onetap-1", button_id: created.button.id });
    let overview = await getQuickLogOverview(workerEnv, USER);
    expect(overview.buttons[0].today_count).toBe(1);
    expect(overview.buttons[0].streak).toBe(0);
    expect(overview.buttons[0].week).toHaveLength(7);

    await createQuickLogEntry(workerEnv, USER, { id: "flow-onetap-2", button_id: created.button.id });
    overview = await getQuickLogOverview(workerEnv, USER);
    expect(overview.buttons[0].today_count).toBe(2);
    expect(overview.buttons[0].streak).toBe(1);
    expect(overview.summary.achieved).toBe(1);
    expect(overview.summary.log_count).toBe(2);
  });

  it("항목선택형 버튼: 등록된 항목 칩만 기록 허용, 미등록 값은 거부", async () => {
    const created = await createQuickLogButton(workerEnv, USER, {
      label: "영양제", emoji: "💊", input_mode: "pick_item", items: ["오메가3", "비타민D"],
    });

    const logged = await createQuickLogEntry(workerEnv, USER, {
      id: "flow-pick-1", button_id: created.button.id, item_label: "오메가3", note: "아침 식후",
    });
    expect(logged.log.item_label).toBe("오메가3");

    await expect(createQuickLogEntry(workerEnv, USER, {
      id: "flow-pick-2", button_id: created.button.id, item_label: "직접입력값",
    })).rejects.toMatchObject({ status: 400, code: "invalid_item_label" });
  });

  it("자유입력형 버튼: 텍스트가 note로 기록되고, 오늘 기록만 삭제 가능", async () => {
    const created = await createQuickLogButton(workerEnv, USER, { label: "메모", input_mode: "free_text" });
    const logged = await createQuickLogEntry(workerEnv, USER, {
      id: "flow-free-1", button_id: created.button.id, note: "회의 중 아이디어 기록",
    });
    expect(logged.log.note).toBe("회의 중 아이디어 기록");

    const deleted = await deleteQuickLogEntry(workerEnv, USER, "flow-free-1");
    expect(deleted.ok).toBe(true);
    expect((await getQuickLogOverview(workerEnv, USER)).logs).toHaveLength(0);

    // soft delete(#252) 이후 재삭제는 404 가 아니라 멱등 성공이다 — 재시도가 실패로 보이면 안 된다.
    expect((await deleteQuickLogEntry(workerEnv, USER, "flow-free-1")).idempotent).toBe(true);
    // 존재하지 않는 id 는 여전히 404
    await expect(deleteQuickLogEntry(workerEnv, USER, "flow-free-unknown"))
      .rejects.toMatchObject({ status: 404, code: "quick_log_entry_not_found" });
  });

  it("버튼 수정으로 항목 교체 반영, soft delete 후에도 이력에는 스냅샷 라벨 유지", async () => {
    const created = await createQuickLogButton(workerEnv, USER, {
      label: "운동", emoji: "🏃", input_mode: "pick_item", items: ["러닝"],
    });
    await createQuickLogEntry(workerEnv, USER, { id: "flow-hist-1", button_id: created.button.id, item_label: "러닝" });

    await updateQuickLogButton(workerEnv, USER, created.button.id, { items: ["러닝", "홈트"] });
    const midOverview = await getQuickLogOverview(workerEnv, USER);
    expect(midOverview.buttons[0].items.map((i) => i.label)).toEqual(["러닝", "홈트"]);

    await deleteQuickLogButton(workerEnv, USER, created.button.id);
    const afterDelete = await getQuickLogOverview(workerEnv, USER);
    expect(afterDelete.buttons).toHaveLength(0);

    const history = await getQuickLogHistory(workerEnv, USER, null, null);
    expect(history.logs).toHaveLength(1);
    expect(history.logs[0].button_label).toBe("운동");
  });

  it("버튼은 최대 8개까지만 생성 가능 — '새 버튼 만들기' 비활성 조건과 일치", async () => {
    for (let i = 0; i < 8; i += 1) {
      await createQuickLogButton(workerEnv, USER, { label: `버튼${i}`, input_mode: "one_tap" });
    }
    await expect(createQuickLogButton(workerEnv, USER, { label: "아홉번째", input_mode: "one_tap" }))
      .rejects.toMatchObject({ status: 400, code: "quick_button_limit" });
  });

  it("위치(REQ-12)는 기록에 저장되고 overview·history에 그대로 노출된다", async () => {
    const created = await createQuickLogButton(workerEnv, USER, { label: "산책", input_mode: "one_tap" });
    await createQuickLogEntry(workerEnv, USER, {
      id: "flow-location-1", button_id: created.button.id, location: "집 근처 공원",
    });

    const overview = await getQuickLogOverview(workerEnv, USER);
    expect(overview.logs[0].location).toBe("집 근처 공원");

    const history = await getQuickLogHistory(workerEnv, USER, null, null);
    expect(history.logs[0].location).toBe("집 근처 공원");
  });

  it("사진(REQ-13) 조회는 기록 소유자만 가능하고, 타 사용자·미존재 키는 404", async () => {
    const created = await createQuickLogButton(workerEnv, USER, { label: "일기", input_mode: "free_text" });
    const photoKey = `quick-log/${USER}/test-photo.jpg`;
    await workerEnv.R2.put(photoKey, "fake-jpeg-bytes", { httpMetadata: { contentType: "image/jpeg" } });
    await createQuickLogEntry(workerEnv, USER, {
      id: "flow-photo-1", button_id: created.button.id, note: "사진 첨부", photo_key: photoKey,
    });

    const response = await getQuickLogPhoto(workerEnv, USER, photoKey);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(await response.text()).toBe("fake-jpeg-bytes");

    await expect(getQuickLogPhoto(workerEnv, "another-user", photoKey))
      .rejects.toMatchObject({ status: 404, code: "quick_log_photo_not_found" });

    await expect(getQuickLogPhoto(workerEnv, USER, "quick-log/unknown/missing.jpg"))
      .rejects.toMatchObject({ status: 404, code: "quick_log_photo_not_found" });
  });

  it("오늘 진행도는 버튼 수 단위로 계산되고, 횟수 합은 goal_total 로 따로 제공된다 (#248)", async () => {
    const water = await createQuickLogButton(workerEnv, USER, {
      label: "물 마시기", input_mode: "one_tap", goal_count: 3,
    });
    await createQuickLogButton(workerEnv, USER, { label: "영양제", input_mode: "one_tap", goal_count: 1 });

    let overview = await getQuickLogOverview(workerEnv, USER);
    // 버튼 2개 / 목표 횟수 합 4회 — 두 값이 섞이면 안 된다.
    expect(overview.summary.target).toBe(2);
    expect(overview.summary.goal_total).toBe(4);
    expect(overview.summary.achieved).toBe(0);
    expect(overview.summary.achieved).toBeLessThanOrEqual(overview.summary.target);

    for (const id of ["sum-1", "sum-2", "sum-3"]) {
      await createQuickLogEntry(workerEnv, USER, { id, button_id: water.button.id });
    }
    overview = await getQuickLogOverview(workerEnv, USER);
    expect(overview.summary.achieved).toBe(1);
    expect(overview.summary.target).toBe(2);
    expect(overview.summary.log_count).toBe(3);
  });

  it("기록 실행 취소 — 클라이언트가 만든 id 로 방금 남긴 기록을 되돌린다 (#248)", async () => {
    const created = await createQuickLogButton(workerEnv, USER, { label: "커피", input_mode: "one_tap" });
    const logId = "flow-undo-1";
    await createQuickLogEntry(workerEnv, USER, { id: logId, button_id: created.button.id });

    let overview = await getQuickLogOverview(workerEnv, USER);
    expect(overview.buttons[0].today_count).toBe(1);
    expect(overview.summary.achieved).toBe(1);

    await deleteQuickLogEntry(workerEnv, USER, logId);

    overview = await getQuickLogOverview(workerEnv, USER);
    expect(overview.buttons[0].today_count).toBe(0);
    expect(overview.buttons[0].streak).toBe(0);
    expect(overview.summary.achieved).toBe(0);
    expect(overview.summary.log_count).toBe(0);
  });

  it("soft delete 후 복구하면 logged_at 이 원래 값 그대로 유지된다 (#252)", async () => {
    const created = await createQuickLogButton(workerEnv, USER, { label: "커피", input_mode: "one_tap" });
    await createQuickLogEntry(workerEnv, USER, { id: "soft-1", button_id: created.button.id });

    let overview = await getQuickLogOverview(workerEnv, USER);
    const originalLoggedAt = overview.logs[0].logged_at;
    expect(originalLoggedAt).toBeTruthy();

    // 삭제 직후에는 어떤 집계에도 잡히지 않아야 한다
    await deleteQuickLogEntry(workerEnv, USER, "soft-1");
    overview = await getQuickLogOverview(workerEnv, USER);
    expect(overview.logs).toHaveLength(0);
    expect(overview.buttons[0].today_count).toBe(0);
    expect(overview.buttons[0].week.every((day) => day.count === 0)).toBe(true);
    expect(overview.summary.log_count).toBe(0);
    const historyAfterDelete = await getQuickLogHistory(workerEnv, USER, null, null);
    expect(historyAfterDelete.logs).toHaveLength(0);

    // 잠시 뒤 복구해도 기록 시각은 그대로여야 한다 (이 이슈의 핵심)
    await new Promise((resolve) => setTimeout(resolve, 20));
    await restoreQuickLogEntry(workerEnv, USER, "soft-1");
    overview = await getQuickLogOverview(workerEnv, USER);
    expect(overview.logs).toHaveLength(1);
    expect(overview.logs[0].logged_at).toBe(originalLoggedAt);
    expect(overview.buttons[0].today_count).toBe(1);
    expect(overview.summary.log_count).toBe(1);
  });

  it("삭제·복구는 소유자만 가능하고, 재요청은 멱등 처리된다 (#252)", async () => {
    const created = await createQuickLogButton(workerEnv, USER, { label: "물", input_mode: "one_tap" });
    await createQuickLogEntry(workerEnv, USER, { id: "soft-own-1", button_id: created.button.id });

    await expect(deleteQuickLogEntry(workerEnv, "other-user", "soft-own-1"))
      .rejects.toMatchObject({ status: 403, code: "quick_log_not_owner" });
    await expect(restoreQuickLogEntry(workerEnv, "other-user", "soft-own-1"))
      .rejects.toMatchObject({ status: 404, code: "quick_log_entry_not_found" });

    expect((await deleteQuickLogEntry(workerEnv, USER, "soft-own-1")).idempotent).toBe(false);
    expect((await deleteQuickLogEntry(workerEnv, USER, "soft-own-1")).idempotent).toBe(true);
    expect((await restoreQuickLogEntry(workerEnv, USER, "soft-own-1")).idempotent).toBe(false);
    expect((await restoreQuickLogEntry(workerEnv, USER, "soft-own-1")).idempotent).toBe(true);
  });

  it("뒤늦게 도착한 재시도 POST 가 방금 지운 기록을 되살리지 않는다 (#252)", async () => {
    const created = await createQuickLogButton(workerEnv, USER, { label: "간식", input_mode: "one_tap" });
    await createQuickLogEntry(workerEnv, USER, { id: "soft-retry-1", button_id: created.button.id });
    await deleteQuickLogEntry(workerEnv, USER, "soft-retry-1");

    const retry = await createQuickLogEntry(workerEnv, USER, { id: "soft-retry-1", button_id: created.button.id });
    expect(retry.idempotent).toBe(true);
    expect(retry.deleted).toBe(true);

    const overview = await getQuickLogOverview(workerEnv, USER);
    expect(overview.logs).toHaveLength(0);
    expect(overview.summary.log_count).toBe(0);
  });

  it("동일 클라이언트 id 재전송은 멱등 처리 — 네트워크 재시도로 인한 중복 기록 방지", async () => {
    const created = await createQuickLogButton(workerEnv, USER, { label: "커피", input_mode: "one_tap" });
    const first = await createQuickLogEntry(workerEnv, USER, { id: "flow-idem-1", button_id: created.button.id });
    const retry = await createQuickLogEntry(workerEnv, USER, { id: "flow-idem-1", button_id: created.button.id });
    expect(first.idempotent).toBe(false);
    expect(retry.idempotent).toBe(true);
    const overview = await getQuickLogOverview(workerEnv, USER);
    expect(overview.summary.log_count).toBe(1);
  });
});
