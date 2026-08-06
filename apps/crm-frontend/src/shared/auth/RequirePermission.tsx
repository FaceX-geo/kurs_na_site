import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { CRM_PATHS } from "@/app/paths";
import { useAuth } from "@/shared/auth/AuthProvider";
import { hasAnyPermission, hasPermission } from "@/shared/auth/policy";

export interface RequirePermissionProps {
  allOf?: readonly string[];
  anyOf?: readonly string[];
  children?: ReactNode;
}

export function RequirePermission({ allOf = [], anyOf = [], children }: RequirePermissionProps) {
  const { session } = useAuth();
  const location = useLocation();
  const allAllowed = allOf.every((permission) => hasPermission(session, permission));
  const anyAllowed = anyOf.length === 0 || hasAnyPermission(session, anyOf);
  if (!allAllowed || !anyAllowed) {
    return (
      <Navigate
        replace
        to={CRM_PATHS.denied}
        state={{ from: location.pathname, requiredPermissions: [...allOf, ...anyOf] }}
      />
    );
  }
  return children ?? <Outlet />;
}
