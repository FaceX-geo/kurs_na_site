export interface IdentityOperationDefinition {
  readonly key: "mfa.verify" | "sessions.list_own" | "sessions.list_user";
  readonly operationId: "VerifyMfa" | "ListOwnSessions" | "ListUserSessions";
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly access: "conditional_public_or_reauth" | "authenticated_self" | "permission";
  readonly permissionCode?: "identity.sessions.read_all";
}

export const IDENTITY_OPERATIONS = Object.freeze({
  "mfa.verify": Object.freeze({
    key: "mfa.verify",
    operationId: "VerifyMfa",
    method: "POST",
    path: "/internal/v1/auth/mfa/verify",
    access: "conditional_public_or_reauth",
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
} as const satisfies Record<IdentityOperationDefinition["key"], IdentityOperationDefinition>);

export const IDENTITY_OPERATION_LIST: readonly IdentityOperationDefinition[] = Object.freeze(
  Object.values(IDENTITY_OPERATIONS),
);
