import type { AuthSession, BusinessRole, DataScope } from "@/shared/auth/types";

export const BUSINESS_ROLES = {
  superAdmin: "SUPER_ADMIN",
  specialist: "SPECIALIST",
} as const satisfies Record<string, BusinessRole>;

const SUPER_ADMIN_ROLE_SET = ["platform_superadmin", "crm_admin"] as const;

export interface BusinessIdentitySource {
  businessRole?: unknown;
  employeeProfileId?: unknown;
  roles: readonly string[];
  scopeVisibility?: unknown;
}

export function resolveBusinessRole(source: BusinessIdentitySource): BusinessRole | null {
  if (source.businessRole === "SUPER_ADMIN" || source.businessRole === "SPECIALIST") {
    return source.businessRole;
  }
  return null;
}

export function resolveEmployeeProfileId(source: BusinessIdentitySource): string | null {
  return typeof source.employeeProfileId === "string" && source.employeeProfileId.trim()
    ? source.employeeProfileId
    : null;
}

export function resolveScopeVisibility(source: BusinessIdentitySource): DataScope | null {
  const explicit =
    source.scopeVisibility === "assigned" ||
    source.scopeVisibility === "team" ||
    source.scopeVisibility === "department" ||
    source.scopeVisibility === "all"
      ? source.scopeVisibility
      : null;
  if (explicit) return explicit;
  if (source.roles.includes("crm_lead_specialist")) return "team";
  if (source.roles.includes("crm_project_manager")) return "assigned";
  if (SUPER_ADMIN_ROLE_SET.every((role) => source.roles.includes(role))) return "all";
  return null;
}

export function hasBusinessRole(
  session: AuthSession | null,
  roles: readonly BusinessRole[],
): boolean {
  const role = session?.businessRole;
  return role !== null && role !== undefined && roles.includes(role);
}

export function hasPermission(session: AuthSession | null, permission: string): boolean {
  return session?.user.permissions.includes(permission) ?? false;
}

export function hasAnyPermission(
  session: AuthSession | null,
  permissions: readonly string[],
): boolean {
  return permissions.some((permission) => hasPermission(session, permission));
}
