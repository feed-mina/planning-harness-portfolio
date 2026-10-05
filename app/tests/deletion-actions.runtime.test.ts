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
const JWT_SECRET = "deletion-actions-test-secret";

function testEnv(): Env {
  return { ...workerEnv, JWT_SECRET };
}

async function addUser(userId: string): Promise<string> {
  const now = new Date().toISOString();
  await workerEnv.DB.prepare(
    "INSERT INTO users (id, github_login, github_id, created_at) VALUES (?, ?, NULL, ?)",
  ).bind(userId, userId, now).run();
  const jwt = await signJWT({ sub: userId, login: userId }, JWT_SECRET);
  return `sid=${jwt}`;
}

async function api(cookie: string, path: string, init?: RequestInit) {
  const response = await worker.fetch(new Request(`https://example.test${path}`, {
    ...init,
    headers: { cookie, ...(init?.headers || {}) },
  }), testEnv(), executionContext);
  return { status: response.status, json: await response.json() as any };
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await workerEnv.DB.prepare("DELETE FROM history_marks").run();
  await workerEnv.DB.prepare("DELETE FROM kanban_cards").run();
  await workerEnv.DB.prepare("DELETE FROM kanban_boards").run();
  await workerEnv.DB.prepare("DELETE FROM meetings").run();
  await workerEnv.DB.prepare("DELETE FROM users").run();
});

describe("recoverable history deletion", () => {
  it("hides only the owner's meeting and restores it without deleting the source", async () => {
    const ownerCookie = await addUser("history-delete-owner");
    const otherCookie = await addUser("history-delete-other");
    const now = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT INTO meetings (id, user_id, title, date, r2_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind("meeting-delete-1", "history-delete-owner", "삭제 테스트 회의", "2026-07-18", null, now).run();

    const denied = await api(otherCookie, "/api/history/meeting/meeting-delete-1", { method: "DELETE" });
    expect(denied.status).toBe(404);

    const removed = await api(ownerCookie, "/api/history/meeting/meeting-delete-1", { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(removed.json.recoverable).toBe(true);
    expect(Number.isNaN(Date.parse(removed.json.deleted_at))).toBe(false);

    const hidden = await api(ownerCookie, "/api/history?limit=20");
    expect(hidden.status).toBe(200);
    expect(hidden.json.items).toEqual([]);

    const source = await workerEnv.DB.prepare(
      "SELECT id FROM meetings WHERE id=? AND user_id=?",
    ).bind("meeting-delete-1", "history-delete-owner").first<{ id: string }>();
    expect(source?.id).toBe("meeting-delete-1");

    const detail = await api(ownerCookie, "/api/history/meeting/meeting-delete-1");
    expect(detail.status).toBe(404);

    const restored = await api(ownerCookie, "/api/history/meeting/meeting-delete-1/restore", { method: "POST" });
    expect(restored.status).toBe(200);
    expect(restored.json.restored).toBe(true);

    const visible = await api(ownerCookie, "/api/history?limit=20");
    expect(visible.json.items.map((item: any) => item.id)).toEqual(["meeting-delete-1"]);
  });
});

describe("kanban card deletion", () => {
  it("deletes only an owned local card and leaves GitHub remote state untouched", async () => {
    const ownerCookie = await addUser("kanban-delete-owner");
    const otherCookie = await addUser("kanban-delete-other");
    const now = new Date().toISOString();
    await workerEnv.DB.prepare(
      `INSERT INTO kanban_boards (id, user_id, title, source_kind, source_id, created_at, updated_at)
       VALUES (?, ?, ?, 'meeting', ?, ?, ?)`,
    ).bind("board-delete-1", "kanban-delete-owner", "삭제 보드", "meeting-delete-1", now, now).run();
    await workerEnv.DB.prepare(
      `INSERT INTO kanban_cards (
         id, board_id, user_id, title, priority, status, source_kind, source_raw,
         position, created_at, updated_at, github_repo, github_issue_number, github_issue_url
       ) VALUES (?, ?, ?, ?, 'medium', 'todo', 'meeting_action_item', ?, 0, ?, ?, ?, ?, ?)`,
    ).bind(
      "card-delete-1",
      "board-delete-1",
      "kanban-delete-owner",
      "로컬 카드",
      "로컬 카드",
      now,
      now,
      "feed-mina/planning-harness",
      242,
      "https://github.com/feed-mina/planning-harness/issues/242",
    ).run();

    const denied = await api(otherCookie, "/api/kanban/cards/card-delete-1", { method: "DELETE" });
    expect(denied.status).toBe(404);

    const removed = await api(ownerCookie, "/api/kanban/cards/card-delete-1", { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(removed.json.ok).toBe(true);
    expect(removed.json.github_issue_closed).toBe(false);

    const row = await workerEnv.DB.prepare(
      "SELECT id FROM kanban_cards WHERE id=?",
    ).bind("card-delete-1").first<{ id: string }>();
    expect(row).toBeNull();
  });
});
