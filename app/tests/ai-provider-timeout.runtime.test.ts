import { afterEach, describe, expect, it } from "vitest";
import { generateText, type AISettings } from "../src/ai";
import type { Env } from "../src/env";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function envWithKeys(): Env {
  return {
    ANTHROPIC_API_KEY: "test-anthropic",
    GEMINI_API_KEY: "test-gemini",
    OPENAI_API_KEY: "test-openai",
  } as unknown as Env;
}

function geminiResponse(text: string): Response {
  return Response.json({
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
  });
}

// 실제 60초를 기다리지 않고, provider 호출이 AbortSignal.timeout 으로 끊겼을 때와 같은 오류를 흘려보낸다.
function stubFetch(handler: (url: string) => Response | Promise<Response>): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    return handler(url);
  }) as typeof fetch;
  return seen;
}

describe("AI provider timeouts", () => {
  it("응답 없는 provider 는 중단하고 다음 provider 로 넘어간다", async () => {
    const seen = stubFetch((url) => {
      if (url.includes("api.anthropic.com")) throw new DOMException("The operation was aborted", "TimeoutError");
      if (url.includes("generativelanguage.googleapis.com")) return geminiResponse("대체 provider 결과");
      throw new Error(`unexpected provider call: ${url}`);
    });

    const settings: AISettings = { provider: "claude", model: "claude-sonnet-4-6" };
    const out = await generateText(envWithKeys(), "회의 전사 요약", settings);

    expect(out.text).toBe("대체 provider 결과");
    expect(out.provider).toBe("gemini");
    expect(out.fallbackFrom).toBe("claude/claude-sonnet-4-6");
    expect(seen[0]).toContain("api.anthropic.com");
  });

  it("모든 provider 가 응답하지 않으면 타임아웃 사유를 담아 실패한다", async () => {
    stubFetch(() => {
      throw new DOMException("The operation was aborted", "TimeoutError");
    });

    await expect(generateText(envWithKeys(), "회의 전사 요약", { provider: "gemini", model: "gemini-2.5-pro" }))
      .rejects.toThrow(/provider_timeout/);
  });
});
