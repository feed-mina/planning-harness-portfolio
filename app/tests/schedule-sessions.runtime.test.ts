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
const JWT_SECRET = "schedule-session-test-secret";

function testEnv(): Env {
  return { ...workerEnv, JWT_SECRET };
}

async function addUser(userId: string): Promise<string> {
  const ts = new Date().toISOString();
  await workerEnv.DB.prepare(
    "INSERT INTO users (id, github_login, github_id, created_at) VALUES (?1, ?2, NULL, ?3)",
  ).bind(userId, userId, ts).run();
  const jwt = await signJWT({ sub: userId, login: userId }, JWT_SECRET);
  return `sid=${jwt}`;
}

async function api(cookie: string, path: string, init?: RequestInit) {
  const res = await worker.fetch(new Request(`https://example.test${path}`, {
    ...init,
    headers: { cookie, ...(init?.headers || {}) },
  }), testEnv(), executionContext);
  return { status: res.status, json: await res.json() as any };
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await workerEnv.DB.prepare("DELETE FROM schedule_session_entries").run();
  await workerEnv.DB.prepare("DELETE FROM schedule_session_reports").run();
  await workerEnv.DB.prepare("DELETE FROM schedule_session_links").run();
  await workerEnv.DB.prepare("DELETE FROM schedule_sessions").run();
  await workerEnv.DB.prepare("DELETE FROM github_schedule_sources").run();
  await workerEnv.DB.prepare("DELETE FROM users").run();
});

describe("schedule GitHub sources", () => {
  it("stores multiple repo and Project connections for one user", async () => {
    const cookie = await addUser("schedule-source-user");
    const saved = await api(cookie, "/api/schedule/sources", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sources: [
          { repo: "feed-mina/planning-harness", project_id: "PVT_1", project_title: "Planning" },
          { repo: "feed-mina/auto-media", project_id: "PVT_1", project_title: "Planning" },
        ],
      }),
    });
    expect(saved.status).toBe(200);
    expect(saved.json.sources).toHaveLength(2);
    expect(saved.json.sources.map((source: any) => source.repo)).toEqual([
      "feed-mina/planning-harness",
      "feed-mina/auto-media",
    ]);

    const listed = await api(cookie, "/api/schedule/sources");
    expect(listed.status).toBe(200);
    expect(listed.json.sources).toHaveLength(2);
  });

  it("rejects duplicate repo and Project pairs", async () => {
    const cookie = await addUser("schedule-duplicate-user");
    const result = await api(cookie, "/api/schedule/sources", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sources: [
          { repo: "feed-mina/planning-harness", project_id: "PVT_1", project_title: "Planning" },
          { repo: "feed-mina/planning-harness", project_id: "PVT_1", project_title: "Planning" },
        ],
      }),
    });
    expect(result.status).toBe(400);
    expect(result.json.code).toBe("duplicate_source");
  });

  it("keeps pull requests read-only in the Kanban sync API", async () => {
    const cookie = await addUser("schedule-pr-user");
    const result = await api(cookie, "/api/schedule/github-items", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "pr",
        repo: "feed-mina/planning-harness",
        number: 259,
        state: "closed",
        importance: "high",
        urgency: "high",
      }),
    });
    expect(result.status).toBe(400);
    expect(result.json.code).toBe("github_item_read_only");
  });
});

describe("schedule sessions", () => {
  it("returns sessions and issue links inside the requested range", async () => {
    const cookie = await addUser("schedule-session-user");
    const now = new Date().toISOString();
    await workerEnv.DB.batch([
      workerEnv.DB.prepare(
        `INSERT INTO schedule_sessions (
          id, user_id, title, starts_at, ends_at, status, repo, project_id, project_title, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)`
      ).bind(
        "session-1",
        "schedule-session-user",
        "Issue planning",
        "2026-08-03T01:00:00.000Z",
        "2026-08-03T02:00:00.000Z",
        "feed-mina/planning-harness",
        "PVT_1",
        "Planning",
        now,
        now,
      ),
      workerEnv.DB.prepare(
        `INSERT INTO schedule_session_links (
          id, session_id, kind, repo, project_id, project_title, number, title, state, created_at, updated_at
        ) VALUES (?, ?, 'issue', ?, ?, ?, ?, ?, 'open', ?, ?)`
      ).bind(
        "link-1",
        "session-1",
        "feed-mina/planning-harness",
        "PVT_1",
        "Planning",
        242,
        "Schedule schema",
        now,
        now,
      ),
    ]);

    const result = await api(
      cookie,
      "/api/schedule/sessions?from=2026-08-01T00:00:00Z&to=2026-08-10T00:00:00Z",
    );
    expect(result.status).toBe(200);
    expect(result.json.sessions).toHaveLength(1);
    expect(result.json.sessions[0].links[0].number).toBe(242);
    expect(Number.isNaN(Date.parse(result.json.server_now))).toBe(false);
  });

  it("creates and updates a session with links, report, and attendance evidence", async () => {
    const cookie = await addUser("schedule-session-mutation-user");
    const created = await api(cookie, "/api/schedule/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Issue 242 review",
        starts_at: "2026-08-05T01:00:00.000Z",
        ends_at: "2026-08-05T02:00:00.000Z",
        host_name: "Planning Harness",
        meeting_url: "https://meet.example.test/issue-242",
        links: [
          {
            kind: "issue",
            repo: "feed-mina/planning-harness",
            number: 242,
            title: "Schedule schema",
            state: "open",
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    expect(created.json.session.title).toBe("Issue 242 review");
    expect(created.json.session.room_key).toBeNull();
    expect(created.json.session.meeting_url).toBe("https://meet.example.test/issue-242");
    expect(created.json.session.links[0].number).toBe(242);
    expect(created.json.session.report).toBeNull();
    expect(created.json.session.entries).toEqual([]);

    const sessionId = created.json.session.id as string;
    const report = await api(cookie, `/api/schedule/sessions/${sessionId}/report`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summary: "D1 and API contracts reviewed.",
        next_actions: ["Verify staging OAuth", "Check the real schedule screen"],
      }),
    });
    expect(report.status).toBe(200);
    expect(report.json.report.next_actions).toEqual([
      "Verify staging OAuth",
      "Check the real schedule screen",
    ]);

    const entered = await api(cookie, `/api/schedule/sessions/${sessionId}/entries`, {
      method: "POST",
    });
    expect(entered.status).toBe(201);
    expect(entered.json.entry.left_at).toBeNull();
    const entryId = entered.json.entry.id as string;

    const duplicateEnter = await api(cookie, `/api/schedule/sessions/${sessionId}/entries`, {
      method: "POST",
    });
    expect(duplicateEnter.status).toBe(200);
    expect(duplicateEnter.json.entry.id).toBe(entryId);

    const left = await api(cookie, `/api/schedule/sessions/${sessionId}/entries/${entryId}`, {
      method: "PATCH",
    });
    expect(left.status).toBe(200);
    expect(Number.isNaN(Date.parse(left.json.entry.left_at))).toBe(false);

    const updated = await api(cookie, `/api/schedule/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "canceled",
        links: [
          {
            kind: "pr",
            repo: "feed-mina/planning-harness",
            number: 259,
            title: "Mypage schedule",
            state: "merged",
          },
        ],
      }),
    });
    expect(updated.status).toBe(200);
    expect(updated.json.session.status).toBe("canceled");
    expect(Number.isNaN(Date.parse(updated.json.session.canceled_at))).toBe(false);
    expect(updated.json.session.links).toHaveLength(1);
    expect(updated.json.session.links[0].kind).toBe("pr");
    expect(updated.json.session.report.summary).toBe("D1 and API contracts reviewed.");
    expect(updated.json.session.entries[0].left_at).toBe(left.json.entry.left_at);

    const detail = await api(cookie, `/api/schedule/sessions/${sessionId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.session.id).toBe(sessionId);

    const canceledByDelete = await api(cookie, `/api/schedule/sessions/${sessionId}`, {
      method: "DELETE",
    });
    expect(canceledByDelete.status).toBe(200);
    expect(canceledByDelete.json.session.status).toBe("canceled");
    expect(canceledByDelete.json.session.report.summary).toBe("D1 and API contracts reviewed.");
  });

  it("rejects invalid session input and cross-user access", async () => {
    const ownerCookie = await addUser("schedule-session-owner");
    const otherCookie = await addUser("schedule-session-other");
    const invalid = await api(ownerCookie, "/api/schedule/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Invalid meeting",
        starts_at: "2026-08-05T02:00:00.000Z",
        ends_at: "2026-08-05T01:00:00.000Z",
        meeting_url: "http://meet.example.test/not-https",
      }),
    });
    expect(invalid.status).toBe(400);
    expect(invalid.json.code).toBe("invalid_session_time");

    const created = await api(ownerCookie, "/api/schedule/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Owner-only session",
        starts_at: "2026-08-05T01:00:00.000Z",
        ends_at: "2026-08-05T02:00:00.000Z",
      }),
    });
    const sessionId = created.json.session.id as string;

    for (const [path, init] of [
      [`/api/schedule/sessions/${sessionId}`, undefined],
      [`/api/schedule/sessions/${sessionId}/report`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: "Not mine" }),
      }],
      [`/api/schedule/sessions/${sessionId}/entries`, { method: "POST" }],
    ] satisfies Array<[string, RequestInit | undefined]>) {
      const denied = await api(otherCookie, path, init);
      expect(denied.status).toBe(404);
      expect(denied.json.code).toBe("schedule_session_not_found");
    }

    const invalidMeetingUrl = await api(ownerCookie, `/api/schedule/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meeting_url: "http://meet.example.test/not-https" }),
    });
    expect(invalidMeetingUrl.status).toBe(400);
    expect(invalidMeetingUrl.json.code).toBe("invalid_meeting_url");
  });
});
