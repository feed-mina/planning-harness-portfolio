export const PROJECT_ROLES = Object.freeze(["owner", "admin", "editor", "viewer"]);

const permissions = Object.freeze({
  owner: ["project.read", "project.write", "package.import", "package.export", "deployment.publish", "audit.read", "access.manage"],
  admin: ["project.read", "project.write", "package.import", "package.export", "deployment.publish", "audit.read"],
  editor: ["project.read", "project.write", "package.import", "package.export"],
  viewer: ["project.read"],
});

export function projectRoleAllows(role, permission) {
  return permissions[role]?.includes(permission) || false;
}

export function requireProjectPermission(principal, permission) {
  if (!principal?.id || !PROJECT_ROLES.includes(principal.role)) {
    throw Object.assign(new Error("Project principal is invalid"), { status: 403, code: "forbidden" });
  }
  if (!projectRoleAllows(principal.role, permission)) {
    throw Object.assign(new Error(`${principal.role} cannot perform ${permission}`), { status: 403, code: "forbidden" });
  }
  return principal;
}

export function defaultApiKeyPrincipal(request) {
  return Object.freeze({ id: request.headers.get("x-studio-actor") || "studio-user", role: "owner" });
}
