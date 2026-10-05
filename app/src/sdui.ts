import type { Env } from "./env";

type UiNodeType = "TEXT" | "INPUT" | "TEXTAREA" | "FILE_INPUT" | "SELECT" | "CHECKBOX" | "BUTTON" | "GROUP" | "WIDGET";

interface UiMetadataRow {
  page_key: string;
  node_id: string;
  component_type: string;
  props_json: string | null;
  parent_node_id: string | null;
  group_direction: string | null;
  order_index: number | null;
  action_type: string | null;
  ref_data_id: string | null;
  allowed_roles: string | null;
}

export interface UiNode {
  id: string;
  type: UiNodeType;
  props: Record<string, unknown>;
  action?: string;
  refDataId?: string;
  groupDirection?: "ROW" | "COLUMN";
  children?: UiNode[];
}

export interface UiPageResult {
  pageKey: string;
  tree: UiNode;
}

type UiAuthProvider = "github" | "google" | "kakao" | "naver" | "email" | null;

const COMPONENT_TYPES = new Set(["TEXT", "INPUT", "TEXTAREA", "FILE_INPUT", "SELECT", "CHECKBOX", "BUTTON", "GROUP", "WIDGET"]);

function parseProps(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function roleAllowed(raw: string | null, loggedIn: boolean, provider: UiAuthProvider = null): boolean {
  const roles = String(raw || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!roles.length || roles.includes("public")) return true;
  return roles.some((role) => {
    if (role === "user" || role === "logged_in") return loggedIn;
    if (role === "anon" || role === "anonymous") return !loggedIn;
    if (role.startsWith("provider:")) return loggedIn && provider === role.slice("provider:".length);
    if (role === "github" || role === "google" || role === "kakao" || role === "naver" || role === "email") return loggedIn && provider === role;
    return false;
  });
}

function normalizedType(type: string): UiNodeType | null {
  const value = String(type || "").toUpperCase();
  return COMPONENT_TYPES.has(value) ? value as UiNodeType : null;
}

export function buildTree(rows: UiMetadataRow[], loggedIn: boolean, provider: UiAuthProvider = null): UiNode | null {
  const nodes = new Map<string, UiNode>();
  const parentById = new Map<string, string | null>();
  const orderById = new Map<string, number>();

  for (const row of rows) {
    if (!roleAllowed(row.allowed_roles, loggedIn, provider)) continue;
    const type = normalizedType(row.component_type);
    if (!type) continue;
    nodes.set(row.node_id, {
      id: row.node_id,
      type,
      props: parseProps(row.props_json),
      action: row.action_type || undefined,
      refDataId: row.ref_data_id || undefined,
      groupDirection: row.group_direction === "ROW" ? "ROW" : row.group_direction === "COLUMN" ? "COLUMN" : undefined,
      children: [],
    });
    parentById.set(row.node_id, row.parent_node_id || null);
    orderById.set(row.node_id, Number(row.order_index) || 0);
  }

  const roots: UiNode[] = [];
  const visiting = new Set<string>();

  const hasCycle = (id: string): boolean => {
    visiting.clear();
    let current: string | null | undefined = id;
    while (current) {
      if (visiting.has(current)) return true;
      visiting.add(current);
      current = parentById.get(current);
    }
    return false;
  };

  for (const [id, node] of nodes) {
    if (hasCycle(id)) continue;
    const parentId = parentById.get(id);
    const parent = parentId ? nodes.get(parentId) : null;
    if (parent) parent.children?.push(node);
    else roots.push(node);
  }

  const sortChildren = (node: UiNode) => {
    node.children = (node.children || [])
      .sort((a, b) => (orderById.get(a.id) || 0) - (orderById.get(b.id) || 0));
    node.children.forEach(sortChildren);
  };
  roots.sort((a, b) => (orderById.get(a.id) || 0) - (orderById.get(b.id) || 0));
  roots.forEach(sortChildren);

  if (!roots.length) return null;
  if (roots.length === 1) return roots[0];
  return { id: "root", type: "GROUP", props: {}, groupDirection: "COLUMN", children: roots };
}

export async function getUiPage(env: Env, pageKey: string, loggedIn: boolean, provider: UiAuthProvider = null): Promise<UiPageResult | { error: string; status: number }> {
  const cleanPageKey = pageKey.trim().slice(0, 80);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(cleanPageKey)) {
    return { error: "invalid page key", status: 400 };
  }

  const { results } = await env.DB.prepare(
    `SELECT page_key, node_id, component_type, props_json, parent_node_id,
            group_direction, order_index, action_type, ref_data_id, allowed_roles
     FROM ui_metadata
     WHERE page_key=?
     ORDER BY COALESCE(parent_node_id, ''), order_index, node_id`
  ).bind(cleanPageKey).all<UiMetadataRow>();

  if (!results?.length) return { error: "page not found", status: 404 };
  // garden.config.yaml contains GitHub-specific repository configuration. Keep
  // the whole preview subtree out of the SDUI response for other providers so
  // cached clients cannot accidentally render it.
  const visibleResults = cleanPageKey === "garden" && provider !== "github"
    ? results.filter((row) => !/^garden\.preview(?:\.|$)/.test(row.node_id))
    : results;
  const tree = buildTree(visibleResults, loggedIn, provider);
  if (!tree) return { error: "page is empty", status: 404 };
  return { pageKey: cleanPageKey, tree };
}
