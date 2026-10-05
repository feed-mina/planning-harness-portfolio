import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { handleNaverCallback, startNaverAccountLink, startNaverLogin } from "../src/domains/auth";
import type { Env } from "../src/index";

// Naver OAuth 로그인/계정 연결의 네트워크가 필요 없는 경로(리다이렉트 구성·state 검증)만 검증한다.
// 실제 토큰 교환/프로필 조회는 실물 네이버 계정이 필요하므로 여기서 다루지 않는다(#194 Phase 0 실물 검증 항목).
const baseEnv = env as unknown as Env;

function withNaver(overrides: Partial<Env> = {}): Env {
  return {
    ...baseEnv,
    APP_BASE_URL: "https://harness.example",
    NAVER_OAUTH_CLIENT_ID: "test-client-id",
    NAVER_OAUTH_CLIENT_SECRET: "test-client-secret",
    ...overrides,
  } as Env;
}

describe("Naver OAuth login", () => {
  it("returns 500 when the client id is not configured", () => {
    const res = startNaverLogin(new Request("https://harness.example/api/auth/naver"), withNaver({ NAVER_OAUTH_CLIENT_ID: undefined }));
    expect(res.status).toBe(500);
  });

  it("redirects to the Naver authorize endpoint with state and required params", () => {
    const res = startNaverLogin(new Request("https://harness.example/api/auth/naver"), withNaver());
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") || "");
    expect(location.origin + location.pathname).toBe("https://nid.naver.com/oauth2.0/authorize");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe("https://harness.example/api/auth/naver/callback");
    const state = location.searchParams.get("state");
    expect(state).toBeTruthy();
    // state 는 CSRF 방지용으로 HttpOnly 쿠키에 동일하게 심겨야 한다.
    const cookie = res.headers.get("set-cookie") || "";
    expect(cookie).toContain(`oauth_state_naver=${state}`);
    expect(cookie).toContain("HttpOnly");
  });

  it("account link without a session redirects to login_required", async () => {
    const res = await startNaverAccountLink(new Request("https://harness.example/api/auth/naver/link"), withNaver());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/mypage/?account_link=login_required");
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    const res = await handleNaverCallback(new Request(
      "https://harness.example/api/auth/naver/callback?code=abc&state=forged",
      { headers: { cookie: "oauth_state_naver=real-state" } },
    ), withNaver());
    expect(res.status).toBe(400);
  });

  it("returns 500 when secrets are missing on callback", async () => {
    const res = await handleNaverCallback(new Request(
      "https://harness.example/api/auth/naver/callback?code=abc&state=s",
    ), withNaver({ NAVER_OAUTH_CLIENT_SECRET: undefined }));
    expect(res.status).toBe(500);
  });
});
