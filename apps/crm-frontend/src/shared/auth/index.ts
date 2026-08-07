export { AuthProvider, useAuth } from "@/shared/auth/AuthProvider";
export { FreshMfaGate } from "@/shared/auth/FreshMfaGate";
export { resolveAuthMode } from "@/shared/auth/mode";
export { AUTH_PATHS, type AuthPath } from "@/shared/auth/paths";
export {
  BUSINESS_ROLES,
  hasAnyPermission,
  hasBusinessRole,
  hasPermission,
  resolveBusinessRole,
  resolveEmployeeProfileId,
  resolveScopeVisibility,
} from "@/shared/auth/policy";
export { RequireAuth } from "@/shared/auth/RequireAuth";
export { RequireBusinessRole } from "@/shared/auth/RequireBusinessRole";
export { RequirePermission } from "@/shared/auth/RequirePermission";
export { isTestMfaBypassEnabled } from "@/shared/auth/test-runtime";
export type {
  AuthContextValue,
  AuthMode,
  AuthProviderProps,
  AuthSession,
  AuthSessionUser,
  AuthStatus,
  BusinessRole,
  DataScope,
} from "@/shared/auth/types";
