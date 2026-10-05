import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { nblogAccountConnections, type NBlogEnv } from "../src/domains/nblog";

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

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function linkNaverIdentity(userId: string, subject: string, displayName: string | null) {
  const now = "2026-07-22T00:00:00.000Z";
  await workerEnv.DB.prepare(
    "INSERT OR IGNORE INTO users (id, github_login, github_id, created_at) VALUES (?1, ?2, NULL, ?3)"
  ).bind(userId, displayName || userId, now).run();
  await workerEnv.DB.prepare(
    `INSERT INTO user_identities (provider, provider_subject, user_id, email, display_name, avatar_url, created_at, updated_at)
     VALUES ('naver', ?1, ?2, NULL, ?3, NULL, ?4, ?4)`
  ).bind(subject, userId, displayName, now).run();
}

describe("nblogAccountConnections — 네이버 로그인 연결과 브라우저 세션 분리 (#194 Phase 2)", () => {
  it("reports linked=false when the user has no naver identity", async () => {
    const conn = await nblogAccountConnections(workerEnv, "user-none");
    expect(conn.naver_login.linked).toBe(false);
    expect(conn.naver_login.display_name).toBeNull();
    expect(conn.naver_login.linked_at).toBeNull();
  });

  it("reports linked=true with display name and time when the naver identity exists", async () => {
    await linkNaverIdentity("user-linked", "naver-123", "미생맥주");
    const conn = await nblogAccountConnections(workerEnv, "user-linked");
    expect(conn.naver_login.linked).toBe(true);
    expect(conn.naver_login.display_name).toBe("미생맥주");
    expect(conn.naver_login.linked_at).toBe("2026-07-22T00:00:00.000Z");
  });

  it("always marks the browser session as not server-verifiable (별도 경계)", async () => {
    await linkNaverIdentity("user-x", "naver-x", null);
    const conn = await nblogAccountConnections(workerEnv, "user-x");
    // OAuth 연결이 있어도 브라우저 세션은 서버가 확정하지 않는다.
    expect(conn.browser_session.server_verifiable).toBe(false);
    expect(conn.browser_session.source).toBe("browser_extension");
  });
});
