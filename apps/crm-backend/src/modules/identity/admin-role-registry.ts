export type RoleScopeType = "self" | "assigned" | "team" | "department" | "direction" | "project" | "all";

export type RoleChangeAction = "assign" | "revoke";

export type RoleOperationKey =
  | "assign_platform"
  | "assign_crm"
  | "revoke_crm"
  | "assign_project"
  | "revoke_project"
  | "assign_initial_crm_admin"
  | "assign_initial_project_admin"
  | "assign_crm_admin"
  | "assign_project_admin"
  | "revoke_platform"
  | "revoke_crm_admin"
  | "revoke_project_admin"
  | "assign_migration"
  | "revoke_migration"
  | "assign_audit"
  | "revoke_audit";

export interface RoleTargetDefinition {
  readonly code: string;
  readonly scopeTypes: readonly RoleScopeType[];
}

export interface RoleOperationDefinition {
  readonly key: RoleOperationKey;
  readonly operationId: string;
  readonly method: "POST";
  readonly path: string;
  readonly action: RoleChangeAction;
  readonly permissionCode: string;
  readonly domain: "platform" | "crm" | "project" | "migration" | "audit";
  readonly targetRoles: readonly RoleTargetDefinition[];
  readonly roleFromBody: boolean;
  readonly actorRoles: readonly string[];
  readonly criticalApproval: boolean;
  readonly approverRole?: "platform_superadmin" | "crm_admin" | "project_admin";
  readonly requiresClosedProductionBootstrap?: boolean;
  readonly requiresZeroEligibleRole?: boolean;
  readonly requiresExistingEligibleRole?: boolean;
  readonly minimumEligibleAfter?: number;
  readonly nominationRequired?: boolean;
  readonly transferRequired?: boolean;
  readonly ownershipGuard?: "crm" | "transfer_evidence";
}

export const ROLE_PREVIEW_OPERATION = Object.freeze({
  operationId: "PreviewEffectiveAccess",
  method: "POST" as const,
  path: "/internal/v1/admin/users/:userId/roles/preview",
  permissionCode: "identity.roles.preview",
});

const definitions = [
  {
    key: "assign_platform",
    operationId: "AssignPlatformRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/platform/assign",
    action: "assign",
    permissionCode: "identity.roles.assign_platform",
    domain: "platform",
    targetRoles: [{ code: "platform_superadmin", scopeTypes: ["all"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "platform_superadmin",
  },
  {
    key: "assign_crm",
    operationId: "AssignCrmRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/crm/assign",
    action: "assign",
    permissionCode: "identity.roles.assign_crm",
    domain: "crm",
    targetRoles: [
      { code: "crm_project_manager", scopeTypes: ["assigned"] },
      { code: "crm_lead_specialist", scopeTypes: ["team"] },
      { code: "crm_department_head", scopeTypes: ["department"] },
    ],
    roleFromBody: true,
    actorRoles: ["crm_admin"],
    criticalApproval: false,
  },
  {
    key: "revoke_crm",
    operationId: "RevokeCrmRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/crm/revoke",
    action: "revoke",
    permissionCode: "identity.roles.revoke_crm",
    domain: "crm",
    targetRoles: [
      { code: "crm_project_manager", scopeTypes: ["assigned"] },
      { code: "crm_lead_specialist", scopeTypes: ["team"] },
      { code: "crm_department_head", scopeTypes: ["department"] },
    ],
    roleFromBody: true,
    actorRoles: ["crm_admin"],
    criticalApproval: false,
    ownershipGuard: "crm",
  },
  {
    key: "assign_project",
    operationId: "AssignProjectRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/project/assign",
    action: "assign",
    permissionCode: "identity.roles.assign_project",
    domain: "project",
    targetRoles: [
      { code: "project_direction_lead", scopeTypes: ["direction"] },
      { code: "project_manager", scopeTypes: ["project"] },
      { code: "project_executor", scopeTypes: ["assigned"] },
    ],
    roleFromBody: true,
    actorRoles: ["project_admin", "project_manager"],
    criticalApproval: false,
  },
  {
    key: "revoke_project",
    operationId: "RevokeProjectRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/project/revoke",
    action: "revoke",
    permissionCode: "identity.roles.revoke_project",
    domain: "project",
    targetRoles: [
      { code: "project_direction_lead", scopeTypes: ["direction"] },
      { code: "project_manager", scopeTypes: ["project"] },
      { code: "project_executor", scopeTypes: ["assigned"] },
    ],
    roleFromBody: true,
    actorRoles: ["project_admin", "project_manager"],
    criticalApproval: false,
    transferRequired: true,
    ownershipGuard: "transfer_evidence",
  },
  {
    key: "assign_initial_crm_admin",
    operationId: "AssignInitialCrmAdmin",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/crm-admin/initial/assign",
    action: "assign",
    permissionCode: "identity.roles.assign_initial_crm_admin",
    domain: "crm",
    targetRoles: [{ code: "crm_admin", scopeTypes: ["all"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "platform_superadmin",
    requiresClosedProductionBootstrap: true,
    requiresZeroEligibleRole: true,
    nominationRequired: true,
  },
  {
    key: "assign_initial_project_admin",
    operationId: "AssignInitialProjectAdmin",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/project-admin/initial/assign",
    action: "assign",
    permissionCode: "identity.roles.assign_initial_project_admin",
    domain: "project",
    targetRoles: [{ code: "project_admin", scopeTypes: ["all"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "platform_superadmin",
    requiresClosedProductionBootstrap: true,
    requiresZeroEligibleRole: true,
    nominationRequired: true,
  },
  {
    key: "assign_crm_admin",
    operationId: "AssignCrmAdminRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/crm-admin/assign",
    action: "assign",
    permissionCode: "identity.roles.assign_crm_admin",
    domain: "crm",
    targetRoles: [{ code: "crm_admin", scopeTypes: ["all"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "crm_admin",
    requiresExistingEligibleRole: true,
  },
  {
    key: "assign_project_admin",
    operationId: "AssignProjectAdminRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/project-admin/assign",
    action: "assign",
    permissionCode: "identity.roles.assign_project_admin",
    domain: "project",
    targetRoles: [{ code: "project_admin", scopeTypes: ["all"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "project_admin",
    requiresExistingEligibleRole: true,
  },
  {
    key: "revoke_platform",
    operationId: "RevokePlatformRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/platform/revoke",
    action: "revoke",
    permissionCode: "identity.roles.revoke_platform",
    domain: "platform",
    targetRoles: [{ code: "platform_superadmin", scopeTypes: ["all"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "platform_superadmin",
    minimumEligibleAfter: 2,
  },
  {
    key: "revoke_crm_admin",
    operationId: "RevokeCrmAdminRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/crm-admin/revoke",
    action: "revoke",
    permissionCode: "identity.roles.revoke_crm_admin",
    domain: "crm",
    targetRoles: [{ code: "crm_admin", scopeTypes: ["all"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "crm_admin",
    minimumEligibleAfter: 1,
    ownershipGuard: "crm",
  },
  {
    key: "revoke_project_admin",
    operationId: "RevokeProjectAdminRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/project-admin/revoke",
    action: "revoke",
    permissionCode: "identity.roles.revoke_project_admin",
    domain: "project",
    targetRoles: [{ code: "project_admin", scopeTypes: ["all"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "project_admin",
    minimumEligibleAfter: 1,
    transferRequired: true,
    ownershipGuard: "transfer_evidence",
  },
  {
    key: "assign_migration",
    operationId: "AssignMigrationRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/migration/assign",
    action: "assign",
    permissionCode: "identity.roles.assign_migration",
    domain: "migration",
    targetRoles: [{ code: "migration_operator", scopeTypes: ["assigned"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "platform_superadmin",
  },
  {
    key: "revoke_migration",
    operationId: "RevokeMigrationRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/migration/revoke",
    action: "revoke",
    permissionCode: "identity.roles.revoke_migration",
    domain: "migration",
    targetRoles: [{ code: "migration_operator", scopeTypes: ["assigned"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "platform_superadmin",
    transferRequired: true,
    ownershipGuard: "transfer_evidence",
  },
  {
    key: "assign_audit",
    operationId: "AssignAuditRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/audit/assign",
    action: "assign",
    permissionCode: "identity.roles.assign_audit",
    domain: "audit",
    targetRoles: [{ code: "audit_reader", scopeTypes: ["assigned"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "platform_superadmin",
  },
  {
    key: "revoke_audit",
    operationId: "RevokeAuditRole",
    method: "POST",
    path: "/internal/v1/admin/users/:userId/roles/audit/revoke",
    action: "revoke",
    permissionCode: "identity.roles.revoke_audit",
    domain: "audit",
    targetRoles: [{ code: "audit_reader", scopeTypes: ["assigned"] }],
    roleFromBody: false,
    actorRoles: ["platform_superadmin"],
    criticalApproval: true,
    approverRole: "platform_superadmin",
    transferRequired: true,
    ownershipGuard: "transfer_evidence",
  },
] as const satisfies readonly RoleOperationDefinition[];

function buildRegistry(
  operations: readonly RoleOperationDefinition[],
): Readonly<Record<RoleOperationKey, RoleOperationDefinition>> {
  const byKey = new Map<RoleOperationKey, RoleOperationDefinition>();
  const operationIds = new Set<string>();
  const routes = new Set<string>();

  for (const operation of operations) {
    if (byKey.has(operation.key)) {
      throw new Error(`Duplicate role operation key: ${operation.key}`);
    }
    if (operationIds.has(operation.operationId)) {
      throw new Error(`Duplicate role operation id: ${operation.operationId}`);
    }
    const route = `${operation.method} ${operation.path}`;
    if (routes.has(route)) {
      throw new Error(`Duplicate role operation route: ${route}`);
    }
    if (operation.targetRoles.length === 0) {
      throw new Error(`Role operation ${operation.key} has no target roles`);
    }
    if (operation.criticalApproval && !operation.approverRole) {
      throw new Error(`Critical role operation ${operation.key} has no approver role`);
    }
    if (!operation.criticalApproval && operation.approverRole) {
      throw new Error(`Non-critical role operation ${operation.key} unexpectedly has an approver role`);
    }
    byKey.set(
      operation.key,
      Object.freeze({
        ...operation,
        actorRoles: Object.freeze([...operation.actorRoles]),
        targetRoles: Object.freeze(
          operation.targetRoles.map((target) =>
            Object.freeze({ ...target, scopeTypes: Object.freeze([...target.scopeTypes]) }),
          ),
        ),
      }),
    );
    operationIds.add(operation.operationId);
    routes.add(route);
  }

  return Object.freeze(Object.fromEntries(byKey) as Record<RoleOperationKey, RoleOperationDefinition>);
}

export const ROLE_OPERATIONS = buildRegistry(definitions);
export const ROLE_OPERATION_LIST: readonly RoleOperationDefinition[] = Object.freeze(
  Object.values(ROLE_OPERATIONS),
);

export function roleOperation(key: RoleOperationKey): RoleOperationDefinition {
  const definition = ROLE_OPERATIONS[key];
  if (!definition) {
    throw new Error(`Unregistered role operation: ${key}`);
  }
  return definition;
}

export function roleOperationByOperationId(operationId: string): RoleOperationDefinition | undefined {
  return ROLE_OPERATION_LIST.find((operation) => operation.operationId === operationId);
}

export function approvableRoleOperationIds(roles: readonly string[]): readonly string[] {
  const roleSet = new Set(roles);
  return Object.freeze(
    ROLE_OPERATION_LIST.filter(
      (operation) =>
        operation.criticalApproval && operation.approverRole && roleSet.has(operation.approverRole),
    ).map((operation) => operation.operationId),
  );
}
