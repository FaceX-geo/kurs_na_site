export interface IdentityOperationDefinition {
  readonly key:
    | "mfa.verify"
    | "csrf.refresh"
    | "sessions.list_own"
    | "sessions.list_user"
    | "employees.list"
    | "specialists.provision";
  readonly operationId:
    | "VerifyMfa"
    | "RefreshCsrfToken"
    | "ListOwnSessions"
    | "ListUserSessions"
    | "ListProvisionableEmployees"
    | "ProvisionSpecialist";
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly access:
    | "conditional_public_or_reauth"
    | "authenticated_origin"
    | "authenticated_self"
    | "permission";
  readonly permissionCode?:
    | "identity.sessions.read_all"
    | "identity.employees.read"
    | "identity.specialists.provision";
}

export const IDENTITY_OPERATIONS = Object.freeze({
  "mfa.verify": Object.freeze({
    key: "mfa.verify",
    operationId: "VerifyMfa",
    method: "POST",
    path: "/internal/v1/auth/mfa/verify",
    access: "conditional_public_or_reauth",
  }),
  "csrf.refresh": Object.freeze({
    key: "csrf.refresh",
    operationId: "RefreshCsrfToken",
    method: "POST",
    path: "/internal/v1/auth/csrf/refresh",
    access: "authenticated_origin",
  }),
  "sessions.list_own": Object.freeze({
    key: "sessions.list_own",
    operationId: "ListOwnSessions",
    method: "GET",
    path: "/internal/v1/auth/sessions",
    access: "authenticated_self",
  }),
  "sessions.list_user": Object.freeze({
    key: "sessions.list_user",
    operationId: "ListUserSessions",
    method: "GET",
    path: "/internal/v1/admin/users/:userId/sessions",
    access: "permission",
    permissionCode: "identity.sessions.read_all",
  }),
  "employees.list": Object.freeze({
    key: "employees.list",
    operationId: "ListProvisionableEmployees",
    method: "GET",
    path: "/internal/v1/admin/employees",
    access: "permission",
    permissionCode: "identity.employees.read",
  }),
  "specialists.provision": Object.freeze({
    key: "specialists.provision",
    operationId: "ProvisionSpecialist",
    method: "POST",
    path: "/internal/v1/admin/specialists",
    access: "permission",
    permissionCode: "identity.specialists.provision",
  }),
} as const satisfies Record<IdentityOperationDefinition["key"], IdentityOperationDefinition>);

export const IDENTITY_OPERATION_LIST: readonly IdentityOperationDefinition[] = Object.freeze(
  Object.values(IDENTITY_OPERATIONS),
);
