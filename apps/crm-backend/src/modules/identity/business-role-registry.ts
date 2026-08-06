export const BUSINESS_ROLE_CODES = ["SUPER_ADMIN", "SPECIALIST"] as const;

export type BusinessRole = (typeof BUSINESS_ROLE_CODES)[number];
export type InternalBusinessRoleCode = "platform_superadmin" | "crm_project_manager";

export interface BusinessRoleDefinition {
  readonly code: BusinessRole;
  readonly internalRoleCode: InternalBusinessRoleCode;
  readonly title: string;
  readonly defaultScopeType: "all" | "assigned";
}

export const BUSINESS_ROLE_REGISTRY = Object.freeze({
  SUPER_ADMIN: Object.freeze({
    code: "SUPER_ADMIN",
    internalRoleCode: "platform_superadmin",
    title: "Суперадминистратор",
    defaultScopeType: "all",
  }),
  SPECIALIST: Object.freeze({
    code: "SPECIALIST",
    internalRoleCode: "crm_project_manager",
    title: "Специалист",
    defaultScopeType: "assigned",
  }),
} as const satisfies Record<BusinessRole, BusinessRoleDefinition>);

const BUSINESS_ROLE_BY_INTERNAL_ROLE = Object.freeze(
  Object.fromEntries(
    Object.values(BUSINESS_ROLE_REGISTRY).map((definition) => [definition.internalRoleCode, definition.code]),
  ) as Readonly<Record<InternalBusinessRoleCode, BusinessRole>>,
);

export class BusinessRoleConflictError extends Error {
  constructor(readonly businessRoles: readonly BusinessRole[]) {
    super("A user account cannot have more than one active business role");
    this.name = "BusinessRoleConflictError";
  }
}

export function resolveBusinessRole(internalRoleCodes: readonly string[]): BusinessRole | null {
  const businessRoles = [
    ...new Set(
      internalRoleCodes.flatMap((roleCode) => {
        const role = BUSINESS_ROLE_BY_INTERNAL_ROLE[roleCode as InternalBusinessRoleCode];
        return role ? [role] : [];
      }),
    ),
  ];
  if (businessRoles.length > 1) {
    throw new BusinessRoleConflictError(businessRoles);
  }
  return businessRoles[0] ?? null;
}

export function internalRoleForBusinessRole(role: BusinessRole): InternalBusinessRoleCode {
  return BUSINESS_ROLE_REGISTRY[role].internalRoleCode;
}
