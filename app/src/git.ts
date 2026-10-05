// M5 git 연동 — 회의록 → GitHub 이슈/Project(V2). 토큰은 users.gh_token(암호화)에서 복호화.
import type { Env } from "./env";
import { decryptToken } from "./core/auth";

const GH = "https://api.github.com";
const ghHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "user-agent": "harness-meeting-app",
});

// 저장된 OAuth 토큰 복호화. 없으면 null(재로그인 필요).
export async function getUserToken(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT gh_token FROM users WHERE id=?")
    .bind(userId).first<{ gh_token?: string }>();
  if (!row?.gh_token) return null;
  return decryptToken(row.gh_token, env.JWT_SECRET);
}

// 이슈를 만들 수 있는(push 권한) repo 목록.
export async function listRepos(token: string) {
  const res = await fetch(
    `${GH}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`,
    { headers: ghHeaders(token) }
  );
  if (!res.ok) throw new Error(`repos ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any[];
  return data
    .filter((r) => r.permissions?.push)
    .map((r) => ({ full_name: r.full_name, private: !!r.private }));
}

// repo 담당(assignee) 후보.
export async function listAssignees(token: string, owner: string, repo: string) {
  const res = await fetch(`${GH}/repos/${owner}/${repo}/assignees?per_page=100`, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`assignees ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any[];
  return data.map((u) => ({ login: u.login, avatar_url: u.avatar_url }));
}

// 로그인 사용자가 소유한 Projects V2.
export async function listProjects(token: string) {
  const query = `query { viewer { projectsV2(first: 50) { nodes { id title number } } } }`;
  const res = await fetch(`${GH}/graphql`, {
    method: "POST",
    headers: { ...ghHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`projects ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  if (data.errors) throw new Error(`projects: ${data.errors[0]?.message}`);
  return (data.data?.viewer?.projectsV2?.nodes || []).map((p: any) => ({ id: p.id, title: p.title, number: p.number }));
}

export interface GitHubProjectItem {
  id: string;
  content_id: string;
  project_id: string;
  project_title: string;
  project_number: number;
  kind: "issue" | "pr";
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  due_date: string | null;
  created_at: string | null;
  labels: string[];
}

// Project 보드 순서는 오래된 항목부터라, 한 페이지(100개)만 읽으면 최근에 추가한 이슈가 잘린다.
const PROJECT_ITEM_PAGE_SIZE = 100;
const MAX_PROJECT_ITEM_PAGES = 5;

export async function listProjectItems(
  token: string,
  projectId: string,
): Promise<{ project: { id: string; title: string; number: number }; items: GitHubProjectItem[] }> {
  const query = `query($projectId:ID!,$after:String){
    node(id:$projectId){
      ... on ProjectV2 {
        id
        title
        number
        items(first:${PROJECT_ITEM_PAGE_SIZE}, after:$after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            fieldValues(first:20) {
              nodes {
                ... on ProjectV2ItemFieldDateValue { date }
              }
            }
            content {
              ... on Issue {
                id number title url state createdAt
                repository { nameWithOwner }
                labels(first:30) { nodes { name } }
              }
              ... on PullRequest {
                id number title url state isDraft createdAt
                repository { nameWithOwner }
                labels(first:30) { nodes { name } }
              }
            }
          }
        }
      }
    }
  }`;
  let project: any = null;
  const nodes: any[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PROJECT_ITEM_PAGES; page += 1) {
    const res = await fetch(`${GH}/graphql`, {
      method: "POST",
      headers: { ...ghHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { projectId, after } }),
    });
    if (!res.ok) throw new Error(`project items ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as any;
    if (data.errors) throw new Error(`project items: ${data.errors[0]?.message}`);
    project = data.data?.node;
    if (!project?.id) throw new Error("GitHub Project was not found.");
    nodes.push(...(project.items?.nodes || []));
    const pageInfo = project.items?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    if (!pageInfo.endCursor) {
      throw new Error("GitHub Project pagination cursor was missing.");
    }
    if (page === MAX_PROJECT_ITEM_PAGES - 1) {
      throw new Error(`GitHub Project item limit exceeded (${PROJECT_ITEM_PAGE_SIZE * MAX_PROJECT_ITEM_PAGES}).`);
    }
    if (pageInfo.endCursor === after) {
      throw new Error("GitHub Project pagination cursor did not advance.");
    }
    after = pageInfo.endCursor;
  }
  const items: GitHubProjectItem[] = nodes.flatMap((item: any): GitHubProjectItem[] => {
    const content = item?.content;
    const repo = content?.repository?.nameWithOwner;
    if (!content?.id || !repo || !content?.number || !content?.url) return [];
    const labels = (content.labels?.nodes || []).map((label: any) => String(label?.name || "")).filter(Boolean);
    const dueDate = (item.fieldValues?.nodes || []).find((field: any) => field?.date)?.date || null;
    const merged = String(content.state || "").toUpperCase() === "MERGED";
    return [{
      id: item.id,
      content_id: content.id,
      project_id: project.id,
      project_title: String(project.title || ""),
      project_number: Number(project.number || 0),
      kind: content.isDraft !== undefined ? "pr" : "issue",
      repo,
      number: Number(content.number),
      title: String(content.title || ""),
      url: String(content.url),
      state: content.isDraft ? "draft" : merged ? "merged" : String(content.state || "").toLowerCase(),
      due_date: dueDate,
      created_at: content.createdAt ? String(content.createdAt) : null,
      labels,
    }];
  });
  return {
    project: { id: project.id, title: String(project.title || ""), number: Number(project.number || 0) },
    items,
  };
}

export async function createIssue(
  token: string, owner: string, repo: string, title: string, body: string, assignees?: string[]
) {
  const res = await fetch(`${GH}/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: { ...ghHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ title, body, assignees: assignees?.length ? assignees : undefined }),
  });
  if (!res.ok) throw new Error(`issue ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  return { number: data.number as number, url: data.html_url as string, node_id: data.node_id as string };
}

export async function addIssueComment(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
) {
  const res = await fetch(`${GH}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: { ...ghHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`issue comment ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  return { id: data.id as number, url: data.html_url as string };
}

export async function updateIssueState(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  state: "open" | "closed"
) {
  const res = await fetch(`${GH}/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: { ...ghHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) throw new Error(`issue state ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { html_url?: string; state?: string };
  return { url: String(data.html_url || ""), state: data.state === "closed" ? "closed" as const : "open" as const };
}

const MATRIX_LABEL_PREFIXES = ["importance:", "urgency:"];

async function ensureIssueLabel(token: string, owner: string, repo: string, name: string, color: string) {
  const res = await fetch(`${GH}/repos/${owner}/${repo}/labels`, {
    method: "POST",
    headers: { ...ghHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ name, color, description: "Kanban priority matrix" }),
  });
  // 422 also covers a label which has just been created by another request.
  if (res.ok || res.status === 422) return;
  throw new Error(`GitHub label ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Update only the labels owned by the matrix, while preserving every other issue label. */
export async function updateIssuePriorityMatrix(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  importance: "none" | "high" | "low",
  urgency: "none" | "high" | "low",
  state: "open" | "closed",
) {
  const labels = [
    importance === "none" ? "" : `importance:${importance}`,
    urgency === "none" ? "" : `urgency:${urgency}`,
  ].filter(Boolean);
  await Promise.all(labels.map((label) => ensureIssueLabel(
    token,
    owner,
    repo,
    label,
    label === "importance:high" ? "b91c1c" : label === "urgency:high" ? "d97706" : "64748b",
  )));
  const current = await fetch(`${GH}/repos/${owner}/${repo}/issues/${issueNumber}`, { headers: ghHeaders(token) });
  if (!current.ok) throw new Error(`GitHub issue ${current.status}: ${(await current.text()).slice(0, 200)}`);
  const issue = await current.json() as { labels?: Array<{ name?: string }> };
  const preserved = (issue.labels || []).map((label) => label.name || "").filter((name) => name && !MATRIX_LABEL_PREFIXES.some((prefix) => name.startsWith(prefix)));
  const res = await fetch(`${GH}/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: { ...ghHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ state, labels: [...preserved, ...labels] }),
  });
  if (!res.ok) throw new Error(`GitHub issue ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { html_url?: string };
  return { state, labels, url: data.html_url || `https://github.com/${owner}/${repo}/issues/${issueNumber}` };
}

// 생성한 이슈를 Project V2 에 카드로 추가.
export async function addToProject(token: string, projectId: string, contentId: string): Promise<void> {
  const query = `mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item { id } } }`;
  const res = await fetch(`${GH}/graphql`, {
    method: "POST",
    headers: { ...ghHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { p: projectId, c: contentId } }),
  });
  if (!res.ok) throw new Error(`addToProject ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  if (data.errors) throw new Error(`addToProject: ${data.errors[0]?.message}`);
}

export interface ActionItem { title: string; assignee?: string; due?: string; priority?: string; raw: string; }

// 회의록 Markdown 의 "## 할 일 (Action Items)" 섹션을 파싱.
// 라인 형식: - [ ] <할 일> — @담당자 ~YYYY-MM-DD [priority:High|Medium|Low]
export function parseActionItems(markdown: string): ActionItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: ActionItem[] = [];
  let inSection = false;
  for (const line of lines) {
    if (/^#{1,6}\s+.*할\s*일/.test(line)) { inSection = true; continue; }
    if (inSection && /^#{1,6}\s+/.test(line)) break; // 다음 헤더에서 종료
    if (!inSection) continue;
    const m = line.match(/^\s*[-*]\s*\[[ xX]?\]\s*(.+?)\s*$/);
    if (!m) continue;
    const raw = m[1].trim();
    if (!raw || /^<.*>$/.test(raw)) continue; // 빈 자리표시자(<할 일>) 스킵
    const assignee = (raw.match(/@([\w-]+)/) || [])[1];
    const due = (raw.match(/~(\d{4}-\d{2}-\d{2})/) || [])[1];
    const priority = (raw.match(/\[priority:\s*(High|Medium|Low)\]/i) || [])[1];
    const title = raw.split(/\s+—\s+/)[0].replace(/\s+/g, " ").trim();
    if (title) items.push({ title, assignee, due, priority, raw });
  }
  return items;
}
