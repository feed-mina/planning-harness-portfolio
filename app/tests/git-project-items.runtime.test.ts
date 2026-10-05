import { afterEach, describe, expect, it, vi } from "vitest";
import { listProjectItems } from "../src/git";

function projectPage(
  number: number,
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
) {
  return new Response(JSON.stringify({
    data: {
      node: {
        id: "PROJECT_1",
        title: "Planning",
        number: 1,
        items: {
          pageInfo,
          nodes: [{
            id: `ITEM_${number}`,
            fieldValues: { nodes: [] },
            content: {
              id: `ISSUE_${number}`,
              number,
              title: `Issue ${number}`,
              url: `https://github.com/feed-mina/planning-harness/issues/${number}`,
              state: "OPEN",
              createdAt: "2026-08-09T00:00:00Z",
              repository: { nameWithOwner: "feed-mina/planning-harness" },
              labels: { nodes: [] },
            },
          }],
        },
      },
    },
  }), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub Project item pagination", () => {
  it("collects later pages and advances the GraphQL cursor", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables: { after: string | null } };
      return body.variables.after === null
        ? projectPage(100, { hasNextPage: true, endCursor: "cursor-1" })
        : projectPage(101, { hasNextPage: false, endCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listProjectItems("token", "PROJECT_1");

    expect(result.items.map((item) => item.number)).toEqual([100, 101]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      variables: { projectId: "PROJECT_1", after: "cursor-1" },
    });
  });

  it("fails instead of returning partial data when a later page request fails", async () => {
    const fetchMock = vi.fn(async () => fetchMock.mock.calls.length === 1
      ? projectPage(1, { hasNextPage: true, endCursor: "cursor-1" })
      : new Response("upstream unavailable", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listProjectItems("token", "PROJECT_1"))
      .rejects.toThrow("project items 502: upstream unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails explicitly when the five-page safety limit would truncate results", async () => {
    const fetchMock = vi.fn(async () => projectPage(
      fetchMock.mock.calls.length,
      { hasNextPage: true, endCursor: `cursor-${fetchMock.mock.calls.length}` },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listProjectItems("token", "PROJECT_1"))
      .rejects.toThrow("GitHub Project item limit exceeded (500).");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
