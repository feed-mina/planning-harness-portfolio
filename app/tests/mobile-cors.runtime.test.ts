import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";

const executionContext = {} as ExecutionContext;
const workerEnv = {} as Env;

function preflight(origin: string, method = "POST", headers = "content-type, authorization") {
  return worker.fetch(new Request("https://example.test/api/me", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": method,
      "access-control-request-headers": headers,
    },
  }), workerEnv, executionContext);
}

describe("mobile API CORS", () => {
  it.each(["capacitor://localhost", "https://localhost"])("allows %s", async (origin) => {
    const response = await preflight(origin);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("rejects unlisted origins and methods", async () => {
    expect((await preflight("https://evil.example")).status).toBe(403);
    const method = await preflight("capacitor://localhost", "TRACE");
    expect(method.status).toBe(405);
    expect(method.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(await method.json()).toMatchObject({ code: "method_not_allowed" });

    const header = await preflight("capacitor://localhost", "POST", "content-type, x-unsafe-header");
    expect(header.status).toBe(403);
    expect(header.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(await header.json()).toMatchObject({ code: "header_not_allowed" });
  });
});
